"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;
const TEXT_ZH = {
    title: "翻译消息",
    original: "原文",
    translated: "译文",
    hint: "点击“翻译”后生成译文。",
    translate: "翻译",
    translating: "翻译中…",
    close: "关闭",
    empty: "这条消息没有可翻译内容。",
};
const TEXT_EN = {
    title: "Translate Message",
    original: "Original",
    translated: "Translation",
    hint: "Tap Translate to generate the translation.",
    translate: "Translate",
    translating: "Translating…",
    close: "Close",
    empty: "This message has no text to translate.",
};
/** Wraps a Compose state tuple for asynchronous translation updates. */
function useStateCell(ctx, key, initialValue) {
    const pair = ctx.useState(key, initialValue);
    return { value: pair[0], set: pair[1] };
}
/** Selects the dialog labels for the application language. */
function resolveText(locale) {
    return locale.toLowerCase().startsWith("zh") ? TEXT_ZH : TEXT_EN;
}
/** Requires the message snapshot supplied by the menu invocation. */
function requireMessage(message) {
    if (message === null) {
        throw new Error("message is required for message translation");
    }
    return message;
}
/** Selects the translation language from the application locale. */
function resolveTargetLanguage(locale) {
    return locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
}
/** Calls the configured translation model and updates the dialog state. */
async function translateMessage(originalText, targetLanguage, loading, translatedText, errorMessage) {
    if (loading.value || !originalText) {
        return;
    }
    loading.set(true);
    errorMessage.set("");
    try {
        const result = await Tools.Chat.call({
            functionType: "TRANSLATION",
            turns: [
                {
                    kind: "SYSTEM",
                    content: `Translate the user's message into ${targetLanguage}. ` +
                        "Return only the translated text. Preserve formatting and code blocks.",
                },
                {
                    kind: "USER",
                    content: originalText,
                    metadata: {
                        targetLanguage,
                    },
                },
            ],
            recordTokenUsage: false,
        });
        if (result.finishReason === "tool_call") {
            throw new Error("Translation model returned a tool call");
        }
        translatedText.set(result.text.trim());
    }
    catch (error) {
        console.error("message_translation translate failed:", error);
        errorMessage.set(error instanceof Error ? error.message : String(error));
    }
    finally {
        loading.set(false);
    }
}
/** Renders the selected message and its independently requested translation. */
function Screen(ctx) {
    const message = useStateCell(ctx, "message", null);
    const loading = useStateCell(ctx, "loading", false);
    const translatedText = useStateCell(ctx, "translatedText", "");
    const errorMessage = useStateCell(ctx, "errorMessage", "");
    const locale = getLang();
    const text = resolveText(locale);
    const targetLanguage = resolveTargetLanguage(locale);
    const originalText = requireMessage(message.value).content.trim();
    const body = [
        ctx.UI.Text({
            text: text.original,
            style: "labelLarge",
            color: "primary",
            fontWeight: "medium",
        }),
        originalText
            ? ctx.UI.Markdown({
                text: originalText,
                fontSize: 14,
                enableDialogs: false,
            })
            : ctx.UI.Text({
                text: text.empty,
                style: "bodyMedium",
                color: "onSurfaceVariant",
            }),
        ctx.UI.Surface({
            fillMaxWidth: true,
            height: 1,
            containerColor: "outlineVariant",
        }),
    ];
    if (loading.value) {
        body.push(ctx.UI.Box({
            contentAlignment: "center",
            fillMaxWidth: true,
            height: 56,
        }, [
            ctx.UI.Row({ verticalAlignment: "center" }, [
                ctx.UI.CircularProgressIndicator({
                    width: 20,
                    height: 20,
                    strokeWidth: 2,
                }),
                ctx.UI.Spacer({ width: 10 }),
                ctx.UI.Text({
                    text: text.translating,
                    style: "bodyMedium",
                    color: "onSurfaceVariant",
                }),
            ]),
        ]));
    }
    else if (errorMessage.value) {
        body.push(ctx.UI.Text({
            text: errorMessage.value,
            style: "bodyMedium",
            color: "error",
        }));
    }
    else if (translatedText.value) {
        body.push(ctx.UI.Text({
            text: text.translated,
            style: "labelLarge",
            color: "primary",
            fontWeight: "medium",
        }), ctx.UI.Markdown({
            text: translatedText.value,
            fontSize: 14,
            enableDialogs: false,
        }));
    }
    else {
        body.push(ctx.UI.Text({
            text: text.hint,
            style: "bodyMedium",
            color: "onSurfaceVariant",
        }));
    }
    return ctx.UI.AlertDialog({
        title: text.title,
        text: ctx.UI.LazyColumn({
            width: 560,
            spacing: 12,
            modifier: ctx.Modifier.heightIn({ max: 420 }),
        }, body),
        dismissText: text.close,
        confirmText: loading.value ? text.translating : text.translate,
        closeOnConfirm: false,
        closeOnDismiss: true,
        onConfirm: async () => {
            await translateMessage(originalText, targetLanguage, loading, translatedText, errorMessage);
        },
    });
}
