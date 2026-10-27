// Adapted from free-google-translate-geanpn 1.0.2 (MIT). See google-LICENSE.txt.
/**
 * Build the request body for Google Translate API
 */
export function buildRequestBody(text, from, to) {
    return new URLSearchParams({'f.req':JSON.stringify([[['MkEWBc',JSON.stringify([[text.trim(),from,to,1],[]]),null,'generic']]])}).toString();
}
/**
 * Parse the Google Translate response
 */
export function parseResponse(data) {
    if (!data || data.length === 0) {
        return { success: false, error: "Empty response", raw: "" };
    }
    const cleaned = data.replace(/^\)]}'\n?/, "");
    if (cleaned.includes("<!DOCTYPE") || cleaned.includes("<html")) {
        return { success: false, error: "HTML response (rate limit/captcha)", raw: cleaned.substring(0, 500) };
    }
    try {
        const parsed = JSON.parse(cleaned);
        const innerData = JSON.parse(parsed[0][2]);
        if (!innerData || !innerData[1] || !innerData[1][0] || !innerData[1][0][0] || !innerData[1][0][0][5]) {
            return { success: false, error: "Unexpected structure", raw: cleaned.substring(0, 500) };
        }
        const translatedText = innerData[1][0][0][5].reduce((acc, item) => {
            const text = item[0];
            return acc ? `${acc} ${text}` : text;
        }, "");
        return { success: true, text: translatedText };
    }
    catch (parseError) {
        return { success: false, error: `Parse error: ${parseError.message}`, raw: cleaned.substring(0, 500) };
    }
}
/**
 * Build the Google Translate API URL
 */
export function buildTranslateUrl() {
    const url = new URL("https://translate.google.com/_/TranslateWebserverUi/data/batchexecute");
    url.searchParams.set("rpcids", "MkEWBc");
    url.searchParams.set("source-path", "/");
    url.searchParams.set("hl", "en");
    url.searchParams.set("soc-app", "1");
    url.searchParams.set("soc-platform", "1");
    url.searchParams.set("soc-device", "1");
    return url.toString();
}
