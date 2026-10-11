use std::io::{Cursor, Read};

use flate2::read::ZlibDecoder;
use regex::Regex;
use zip::ZipArchive;

/// Converts supported document byte streams into plain text for file tools.
#[derive(Debug, Clone, Default)]
pub struct DocumentConversionUtil;

impl DocumentConversionUtil {
    /// Extracts plain text from a PDF, DOC, or DOCX byte stream.
    pub fn extractText(bytes: &[u8], extension: &str) -> Result<String, String> {
        match extension.trim().to_ascii_lowercase().as_str() {
            "pdf" => Self::extractPdfText(bytes),
            "docx" => Self::extractDocxText(bytes),
            "doc" => Self::extractDocText(bytes),
            value => Err(format!("Unsupported document extension: {value}")),
        }
    }

    /// Extracts literal text operators from a PDF and its Flate-compressed streams.
    pub fn extractPdfText(bytes: &[u8]) -> Result<String, String> {
        if !bytes.starts_with(b"%PDF-") {
            return Err("Invalid PDF header".to_string());
        }

        let mut sources = vec![bytes.to_vec()];
        let mut cursor = 0usize;
        while let Some(streamStart) = findBytes(bytes, b"stream", cursor) {
            let dataStart = skipPdfStreamLineBreak(bytes, streamStart + b"stream".len());
            let Some(streamEnd) = findBytes(bytes, b"endstream", dataStart) else {
                break;
            };
            let compressed = &bytes[dataStart..streamEnd];
            let mut decoded = Vec::new();
            let mut decoder = ZlibDecoder::new(compressed);
            if decoder.read_to_end(&mut decoded).is_ok() && !decoded.is_empty() {
                sources.push(decoded);
            }
            cursor = streamEnd + b"endstream".len();
        }

        let mut fragments = Vec::new();
        for source in sources {
            fragments.extend(pdfLiteralStrings(&source));
        }
        let text = normalizeExtractedText(&fragments.join(" "));
        if text.is_empty() {
            return Err("PDF contains no extractable text".to_string());
        }
        Ok(text)
    }

    /// Extracts paragraph text from the WordprocessingML document entry in a DOCX archive.
    pub fn extractDocxText(bytes: &[u8]) -> Result<String, String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| format!("Invalid DOCX archive: {error}"))?;
        let mut documentXml = String::new();
        archive
            .by_name("word/document.xml")
            .map_err(|error| format!("DOCX document.xml is missing: {error}"))?
            .read_to_string(&mut documentXml)
            .map_err(|error| format!("Unable to read DOCX document.xml: {error}"))?;

        let tokenRegex = Regex::new(
            r"(?is)<w:t\b[^>]*>.*?</w:t>|<w:tab\b[^>]*/>|<w:br\b[^>]*/>|</w:p\s*>",
        )
        .expect("DOCX token regex must compile");
        let mut text = String::new();
        for tokenMatch in tokenRegex.find_iter(&documentXml) {
            let token = tokenMatch.as_str();
            if token.starts_with("<w:t") {
                let Some(openEnd) = token.find('>') else {
                    continue;
                };
                let Some(closeStart) = token.rfind("</") else {
                    continue;
                };
                text.push_str(&decodeXmlEntities(&token[openEnd + 1..closeStart]));
            } else if token.starts_with("<w:tab") {
                text.push('\t');
            } else {
                text.push('\n');
            }
        }

        let text = normalizeExtractedText(&text);
        if text.is_empty() {
            return Err("DOCX contains no extractable text".to_string());
        }
        Ok(text)
    }

    /// Extracts visible ASCII and UTF-16LE runs from a legacy DOC stream.
    pub fn extractDocText(bytes: &[u8]) -> Result<String, String> {
        if bytes.len() < 8 || !bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
            return Err("Invalid DOC compound document header".to_string());
        }

        let mut fragments = Vec::new();
        let mut ascii = String::new();
        let mut index = 0usize;
        while index < bytes.len() {
            let byte = bytes[index];
            if isVisibleDocByte(byte) {
                ascii.push(byte as char);
            } else {
                appendDocRun(&mut fragments, &mut ascii);
            }
            index += 1;
        }
        appendDocRun(&mut fragments, &mut ascii);

        let mut utf16 = String::new();
        index = 0;
        while index + 1 < bytes.len() {
            let low = bytes[index];
            let high = bytes[index + 1];
            if high == 0 && isVisibleDocByte(low) {
                utf16.push(low as char);
                index += 2;
            } else {
                appendDocRun(&mut fragments, &mut utf16);
                index += 1;
            }
        }
        appendDocRun(&mut fragments, &mut utf16);

        let text = normalizeExtractedText(&fragments.join("\n"));
        if text.is_empty() {
            return Err("DOC contains no extractable text".to_string());
        }
        Ok(text)
    }
}

/// Finds a byte sequence in a larger byte slice starting at an offset.
fn findBytes(bytes: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() || start >= bytes.len() || needle.len() > bytes.len() - start {
        return None;
    }
    bytes[start..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| start + offset)
}

/// Skips the line ending that separates a PDF stream marker from its payload.
fn skipPdfStreamLineBreak(bytes: &[u8], mut index: usize) -> usize {
    if bytes.get(index) == Some(&b'\r') {
        index += 1;
        if bytes.get(index) == Some(&b'\n') {
            index += 1;
        }
    } else if bytes.get(index) == Some(&b'\n') {
        index += 1;
    }
    index
}

/// Extracts and unescapes parenthesized PDF literal strings.
fn pdfLiteralStrings(bytes: &[u8]) -> Vec<String> {
    let mut values = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'(' {
            index += 1;
            continue;
        }
        let mut depth = 1usize;
        let mut cursor = index + 1;
        let mut value = Vec::new();
        while cursor < bytes.len() && depth > 0 {
            match bytes[cursor] {
                b'\\' => {
                    cursor += 1;
                    if cursor >= bytes.len() {
                        break;
                    }
                    let escaped = bytes[cursor];
                    match escaped {
                        b'n' => value.push(b'\n'),
                        b'r' => value.push(b'\r'),
                        b't' => value.push(b'\t'),
                        b'b' => value.push(0x08),
                        b'f' => value.push(0x0C),
                        b'(' | b')' | b'\\' => value.push(escaped),
                        b'\r' => {
                            if bytes.get(cursor + 1) == Some(&b'\n') {
                                cursor += 1;
                            }
                        }
                        b'\n' => {}
                        b'0'..=b'7' => {
                            let mut octal = (escaped - b'0') as u8;
                            let mut count = 1usize;
                            while count < 3 {
                                let Some(next) = bytes.get(cursor + 1) else {
                                    break;
                                };
                                if !(b'0'..=b'7').contains(next) {
                                    break;
                                }
                                octal = octal.saturating_mul(8).saturating_add(*next - b'0');
                                cursor += 1;
                                count += 1;
                            }
                            value.push(octal);
                        }
                        _ => value.push(escaped),
                    }
                }
                b'(' => {
                    depth += 1;
                    value.push(b'(');
                }
                b')' => {
                    depth -= 1;
                    if depth > 0 {
                        value.push(b')');
                    }
                }
                byte => value.push(byte),
            }
            cursor += 1;
        }
        if depth == 0 {
            let text = String::from_utf8_lossy(&value).trim().to_string();
            if !text.is_empty() {
                values.push(text);
            }
            index = cursor;
        } else {
            index += 1;
        }
    }
    values
}

/// Decodes the XML entities commonly present in WordprocessingML text runs.
fn decodeXmlEntities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Reports whether a byte is a visible character or document whitespace.
fn isVisibleDocByte(byte: u8) -> bool {
    (32..=126).contains(&byte) || matches!(byte, b'\t' | b'\n' | b'\r')
}

/// Moves a sufficiently long legacy-DOC string run into the output fragments.
fn appendDocRun(fragments: &mut Vec<String>, run: &mut String) {
    let value = run.trim();
    if value.chars().count() >= 3 {
        fragments.push(value.to_string());
    }
    run.clear();
}

/// Normalizes extracted document text while preserving paragraph boundaries.
fn normalizeExtractedText(value: &str) -> String {
    let mut lines = Vec::new();
    let mut blankLines = 0usize;
    for line in value.lines().map(str::trim_end) {
        if line.trim().is_empty() {
            blankLines += 1;
            if blankLines <= 1 && !lines.is_empty() {
                lines.push(String::new());
            }
        } else {
            blankLines = 0;
            lines.push(line.to_string());
        }
    }
    lines.join("\n").trim().to_string()
}
