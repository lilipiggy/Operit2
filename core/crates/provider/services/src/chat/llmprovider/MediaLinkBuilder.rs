pub struct MediaLinkBuilder;

impl MediaLinkBuilder {
    /// Builds a canonical image media-link tag.
    pub fn image(id: &str) -> String {
        format!("<link type=\"image\" id=\"{}\"></link>", id)
    }

    /// Builds a canonical audio media-link tag.
    pub fn audio(id: &str) -> String {
        format!("<link type=\"audio\" id=\"{}\"></link>", id)
    }

    /// Builds a canonical video media-link tag.
    pub fn video(id: &str) -> String {
        format!("<link type=\"video\" id=\"{}\"></link>", id)
    }

    /// Builds a canonical file media-link tag with an escaped filename.
    pub fn file(id: &str, file_name: &str) -> String {
        format!(
            "<link type=\"file\" id=\"{}\" filename=\"{}\"></link>",
            id,
            escape_xml_attribute(file_name)
        )
    }
}

/// Escapes XML attribute characters used in canonical media-link filenames.
fn escape_xml_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
