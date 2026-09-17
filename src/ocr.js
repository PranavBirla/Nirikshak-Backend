const fs = require("fs/promises");

const VISION_ENDPOINT =
    "https://vision.googleapis.com/v1/images:annotate";


// ============================================================
// 1. Convert a Vision bounding polygon into our rectangle
// ============================================================

function polygonToBoundingBox(boundingPoly) {
    const vertices =
        boundingPoly?.vertices ||
        boundingPoly?.normalizedVertices ||
        [];

    if (!vertices.length) {
        return {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };
    }

    const xs = vertices.map(
        (vertex) => Number(vertex.x ?? 0)
    );

    const ys = vertices.map(
        (vertex) => Number(vertex.y ?? 0)
    );

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}


// ============================================================
// 2. Extract OCR words from Vision's hierarchy
//
// Vision response:
// page → block → paragraph → word → symbol
// ============================================================

function extractWords(annotation) {
    const words = [];

    for (const page of annotation?.pages || []) {
        for (const block of page.blocks || []) {
            for (const paragraph of block.paragraphs || []) {
                for (const word of paragraph.words || []) {
                    const text = (word.symbols || [])
                        .map((symbol) => symbol.text || "")
                        .join("");

                    if (!text.trim()) {
                        continue;
                    }

                    words.push({
                        text,
                        confidence:
                            word.confidence ?? null,
                        boundingBox:
                            polygonToBoundingBox(
                                word.boundingBox
                            )
                    });
                }
            }
        }
    }

    return words;
}


// ============================================================
// 3. Call Google Vision REST API
// ============================================================

async function analyzeImage(imagePath) {
    const apiKey =
        process.env.GOOGLE_VISION_API_KEY;

    if (!apiKey) {
        throw new Error(
            "GOOGLE_VISION_API_KEY environment variable is not set."
        );
    }

    if (!imagePath) {
        throw new Error(
            "Image path is required."
        );
    }

    // Read uploaded/local image.
    const imageBuffer =
        await fs.readFile(imagePath);

    const base64Image =
        imageBuffer.toString("base64");

    const requestBody = {
        requests: [
            {
                image: {
                    content: base64Image
                },
                features: [
                    {
                        type: "DOCUMENT_TEXT_DETECTION"
                    }
                ]
            }
        ]
    };

    const url =
        `${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type":
                "application/json; charset=utf-8"
        },
        body: JSON.stringify(requestBody)
    });

    let data;

    try {
        data = await response.json();
    } catch (error) {
        throw new Error(
            `Google Vision returned a non-JSON response (HTTP ${response.status}).`
        );
    }

    // HTTP-level failure.
    if (!response.ok) {
        const message =
            data?.error?.message ||
            "Google Vision request failed.";

        throw new Error(
            `Google Vision HTTP ${response.status}: ${message}`
        );
    }

    // Vision can return an error inside responses[0]
    // even when the HTTP request itself succeeded.
    const firstResponse =
        data?.responses?.[0];

    if (firstResponse?.error) {
        throw new Error(
            `Google Vision error: ${
                firstResponse.error.message ||
                "Unknown Vision error."
            }`
        );
    }

    const annotation =
        firstResponse?.fullTextAnnotation;

    // No text detected.
    if (!annotation) {
        return {
            text: "",
            words: []
        };
    }

    const words =
        extractWords(annotation);

    return {
        text: annotation.text || "",
        words
    };
}


// ============================================================
// 4. Export
// ============================================================

module.exports = {
    analyzeImage
};