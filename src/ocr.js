const vision = require("@google-cloud/vision");
const { groupWordsIntoLines } = require("./layout");
const { detectFieldLabels } = require("./extractor3");
const { extractFields } = require("./extractor3");
const client = new vision.ImageAnnotatorClient();

async function analyzeImage(imagePath) {
    const [result] = await client.documentTextDetection(imagePath);

    const annotation = result.fullTextAnnotation;

    if (!annotation) {
        return {
            text: "",
            words: []
        };
    }

    const words = [];

    for (const page of annotation.pages || []) {
        for (const block of page.blocks || []) {
            for (const paragraph of block.paragraphs || []) {
                for (const word of paragraph.words || []) {
                    const wordText = (word.symbols || [])
                        .map((symbol) => symbol.text)
                        .join("");

                    const vertices = word.boundingBox?.vertices || [];

                    const xs = vertices.map((v) => v.x || 0);
                    const ys = vertices.map((v) => v.y || 0);

                    const minX = Math.min(...xs);
                    const minY = Math.min(...ys);
                    const maxX = Math.max(...xs);
                    const maxY = Math.max(...ys);

                    words.push({
                        text: wordText,
                        confidence: word.confidence ?? null,
                        boundingBox: {
                            x: minX,
                            y: minY,
                            width: maxX - minX,
                            height: maxY - minY
                        }
                    });
                }
            }
        }
    }

    return {
        text: annotation.text || "",
        words
    };
}

module.exports = {
    analyzeImage
};