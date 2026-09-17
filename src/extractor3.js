// ============================================================
// NIRIKSHAK 1.0 - extractor.js (v3)
//
// Goal:
//   Extract packaged-commodity declaration fields from Google
//   Vision OCR words + bounding boxes.
//
// Supported layouts:
//   1. RIGHT  -> "MRP : 225.00"
//   2. BELOW  -> "MRP" followed by "225.00"
//
// Important design rules:
//   - Only RIGHT and BELOW relationships are considered.
//   - A value must pass the field-specific type validator.
//   - A value must be physically close to its label.
//   - OCR label words can never become field values.
//   - One OCR value can belong to only one field.
//   - Suspicious/vertical OCR boxes are ignored.
//   - Otherwise the field remains null rather than forcing a value.
//
// This is a deterministic prototype. It is intentionally not a
// legal-decision engine.
// ============================================================


// ============================================================
// 1. FIELD DEFINITIONS
// ============================================================

const FIELD_DEFINITIONS = {
    mrp: {
        aliases: [
            "MRP",
            "M.R.P",
            "M.R.P.",
            "MAXIMUM RETAIL PRICE"
        ],
        valueType: "price"
    },

    lotNo: {
        aliases: [
            "LOT",
            "LOT NO",
            "LOT NO.",
            "BATCH",
            "BATCH NO",
            "BATCH NO."
        ],
        valueType: "lot"
    },

    quantity: {
        aliases: [
            "NET WEIGHT",
            "NET WT",
            "NET QTY",
            "NET QUANTITY",
            "QUANTITY",
            "NET CONTENT",
            "NET CONTENTS",
            "NET VOLUME"
        ],
        valueType: "quantity"
    },

    mfg: {
        aliases: [
            "MFG",
            "MFD",
            "PKD",
            "MANUFACTURED",
            "MANUFACTURING DATE",
            "MFG DATE",
            "MFG. DATE",
            "MFD DATE",
            "PACKED ON",
            "PACKAGING DATE",
            "PACKED"
        ],
        valueType: "date"
    },

    expiryDate: {
        aliases: [
            "EXPIRY",
            "EXPIRY DATE",
            "EXP",
            "EXP DATE",
            "EXPIRY DATE",
            "USE BY",
            "BEST BEFORE",
            "BEST BEFORE DATE",
            "EXP. DATE"
        ],
        valueType: "date"
    },

    usp: {
        aliases: [
            "USP",
            "U.S.P.",
            "UNIT SALE PRICE",
            "UNIT SELLING PRICE"
        ],
        valueType: "price"
    }
};


// ============================================================
// 2. GENERAL CONSTANTS
// ============================================================

const MAX_LABEL_WORDS = 4;

// Values with very tall/narrow OCR boxes are often side text,
// barcode text, or other unrelated OCR regions.
const MAX_VALUE_VERTICAL_RATIO = 4.5;

// If no sufficiently good association exists, leave the field null.
const MIN_ASSOCIATION_SCORE = 135;


// ============================================================
// 3. TEXT HELPERS
// ============================================================

function normalizeText(text) {
    return String(text ?? "")
        .toUpperCase()
        .replace(/[.:()[\],]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


function isPunctuationOnly(text) {
    return /^[^A-Z0-9â‚¹]+$/i.test(
        String(text ?? "").trim()
    );
}


// ============================================================
// 4. ROW / VISUAL-LINE GROUPING
//
// We need visual rows for:
//   - multi-word labels
//   - row-wise value candidates
//   - multi-word values such as "July 2026" or "500 ml"
// ============================================================

function verticalOverlapRatio(boxA, boxB) {
    const top = Math.max(boxA.y, boxB.y);

    const bottom = Math.min(
        boxA.y + boxA.height,
        boxB.y + boxB.height
    );

    const overlap = Math.max(
        0,
        bottom - top
    );

    return overlap / Math.min(
        boxA.height,
        boxB.height
    );
}


function areWordsOnSameRow(wordA, wordB) {
    const boxA = wordA.boundingBox;
    const boxB = wordB.boundingBox;

    const centerYA =
        boxA.y + boxA.height / 2;

    const centerYB =
        boxB.y + boxB.height / 2;

    const centerDifference =
        Math.abs(centerYA - centerYB);

    const maxHeight =
        Math.max(
            boxA.height,
            boxB.height
        );

    // Either boxes overlap vertically, or their centers are
    // close enough relative to the text height.
    return (
        verticalOverlapRatio(boxA, boxB) >= 0.15 ||
        centerDifference <= maxHeight * 0.75
    );
}


function groupWordsIntoRows(words) {
    const sortedWords = [...words]
        .filter(
            (word) =>
                word &&
                word.boundingBox &&
                Number.isFinite(word.boundingBox.x) &&
                Number.isFinite(word.boundingBox.y)
        )
        .sort((a, b) => {
            const centerYA =
                a.boundingBox.y +
                a.boundingBox.height / 2;

            const centerYB =
                b.boundingBox.y +
                b.boundingBox.height / 2;

            if (centerYA !== centerYB) {
                return centerYA - centerYB;
            }

            return (
                a.boundingBox.x -
                b.boundingBox.x
            );
        });

    const rows = [];

    for (const word of sortedWords) {
        const wordCenterY =
            word.boundingBox.y +
            word.boundingBox.height / 2;

        let bestRow = null;
        let smallestDifference = Infinity;

        for (const row of rows) {
            if (!areWordsOnSameRow(word, row.anchorWord)) {
                continue;
            }

            const difference =
                Math.abs(
                    wordCenterY -
                    row.centerY
                );

            if (difference < smallestDifference) {
                smallestDifference = difference;
                bestRow = row;
            }
        }

        if (bestRow) {
            bestRow.words.push(word);

            bestRow.centerY =
                bestRow.words.reduce(
                    (sum, currentWord) =>
                        sum +
                        currentWord.boundingBox.y +
                        currentWord.boundingBox.height / 2,
                    0
                ) / bestRow.words.length;
        } else {
            rows.push({
                centerY: wordCenterY,
                anchorWord: word,
                words: [word]
            });
        }
    }

    for (const row of rows) {
        row.words.sort(
            (a, b) =>
                a.boundingBox.x -
                b.boundingBox.x
        );
    }

    rows.sort(
        (a, b) =>
            a.centerY - b.centerY
    );

    return rows;
}


// ============================================================
// 5. LABEL DETECTION
// ============================================================

function shouldAcceptLabel(
    field,
    candidateWords,
    rowWords,
    startIndex
) {
    const normalized =
        normalizeText(
            candidateWords
                .map((word) => word.text)
                .join(" ")
        );

    // Avoid treating "NET" inside unrelated text as a quantity
    // label unless it is followed by a known quantity term.
    if (
        field === "quantity" &&
        normalized === "NET"
    ) {
        return false;
    }

    // "Mfd. By" / "Mfd. Lic. No." is commonly a manufacturer
    // paragraph, not the MFG DATE declaration we want.
    if (field === "mfg") {
        const afterLabel = rowWords.slice(
            startIndex + candidateWords.length,
            startIndex + candidateWords.length + 3
        );

        const nextMeaningfulWords =
            afterLabel
                .filter(
                    (word) =>
                        !isPunctuationOnly(word.text)
                )
                .map((word) =>
                    normalizeText(word.text)
                );

        if (
            nextMeaningfulWords.includes("BY") ||
            nextMeaningfulWords.includes("LIC") ||
            nextMeaningfulWords.includes("LICENSE") ||
            nextMeaningfulWords.includes("LICNO")
        ) {
            return false;
        }
    }

    // A bare "PACKED" is less reliable than "PACKED ON".
    if (
        field === "mfg" &&
        normalized === "PACKED"
    ) {
        const nextMeaningfulWords =
            rowWords
                .slice(
                    startIndex + candidateWords.length,
                    startIndex + candidateWords.length + 2
                )
                .filter(
                    (word) =>
                        !isPunctuationOnly(word.text)
                )
                .map((word) =>
                    normalizeText(word.text)
                );

        if (
            nextMeaningfulWords.length > 0 &&
            !nextMeaningfulWords.includes("ON")
        ) {
            return false;
        }
    }

    return true;
}


function buildBoundingBox(words) {
    const boxes =
        words.map(
            (word) => word.boundingBox
        );

    const minX = Math.min(
        ...boxes.map((box) => box.x)
    );

    const minY = Math.min(
        ...boxes.map((box) => box.y)
    );

    const maxX = Math.max(
        ...boxes.map(
            (box) =>
                box.x + box.width
        )
    );

    const maxY = Math.max(
        ...boxes.map(
            (box) =>
                box.y + box.height
        )
    );

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}


function detectFieldLabels(words) {
    const rows =
        groupWordsIntoRows(words);

    const labels = [];

    for (const row of rows) {
        const rowWords = row.words;

        for (
            let start = 0;
            start < rowWords.length;
            start++
        ) {
            // Try the longest label first.
            for (
                let length = MAX_LABEL_WORDS;
                length >= 1;
                length--
            ) {
                if (
                    start + length >
                    rowWords.length
                ) {
                    continue;
                }

                const candidateWords =
                    rowWords.slice(
                        start,
                        start + length
                    );

                const combinedText =
                    candidateWords
                        .map(
                            (word) =>
                                word.text
                        )
                        .join(" ");

                const normalizedCandidate =
                    normalizeText(
                        combinedText
                    );

                if (!normalizedCandidate) {
                    continue;
                }

                for (
                    const [
                        field,
                        definition
                    ] of Object.entries(
                        FIELD_DEFINITIONS
                    )
                ) {
                    const matchedAlias =
                        definition.aliases.find(
                            (alias) =>
                                normalizeText(
                                    alias
                                ) ===
                                normalizedCandidate
                        );

                    if (!matchedAlias) {
                        continue;
                    }

                    if (
                        !shouldAcceptLabel(
                            field,
                            candidateWords,
                            rowWords,
                            start
                        )
                    ) {
                        continue;
                    }

                    labels.push({
                        field,
                        label: combinedText,
                        matchedAlias,
                        confidence:
                            candidateWords.reduce(
                                (sum, word) =>
                                    sum +
                                    (
                                        word.confidence ??
                                        0
                                    ),
                                0
                            ) /
                            candidateWords.length,
                        boundingBox:
                            buildBoundingBox(
                                candidateWords
                            ),
                        words: candidateWords
                    });

                    // A longer recognized label owns its words.
                    // We continue the scan after those words.
                    start += length - 1;

                    break;
                }

                // Stop trying shorter aliases once this sequence
                // has matched a field.
                if (
                    labels.length > 0 &&
                    labels[labels.length - 1]
                        .words === candidateWords
                ) {
                    break;
                }
            }
        }
    }

    // Remove accidental duplicates caused by overlapping scans.
    return removeDuplicateLabels(labels);
}


function removeDuplicateLabels(labels) {
    const unique = [];

    for (const label of labels) {
        const alreadyExists =
            unique.some(
                (existing) =>
                    existing.field === label.field &&
                    existing.boundingBox.x ===
                        label.boundingBox.x &&
                    existing.boundingBox.y ===
                        label.boundingBox.y &&
                    existing.boundingBox.width ===
                        label.boundingBox.width &&
                    existing.boundingBox.height ===
                        label.boundingBox.height
            );

        if (!alreadyExists) {
            unique.push(label);
        }
    }

    return unique;
}


// ============================================================
// 6. VALUE VALIDATORS
// ============================================================

function parseNumericPrice(text) {
    const cleaned =
        String(text)
            .toUpperCase()
            .replace(/â‚¹/g, "")
            .replace(/\bRS\.?\b/g, "")
            .replace(/\bINR\b/g, "")
            .replace(/,/g, "")
            .trim();

    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
        return null;
    }

    const number =
        Number(cleaned);

    if (
        !Number.isFinite(number) ||
        number < 0 ||
        number > 10000000
    ) {
        return null;
    }

    return number;
}


function isPrice(text) {
    const normalized =
        String(text ?? "")
            .replace(/\s+/g, " ")
            .trim();

    // Handles:
    // 85
    // 85.00
    // â‚¹85
    // â‚¹ 85.00
    // Rs 85
    // INR 85
    return (
        parseNumericPrice(
            normalized
        ) !== null
    );
}


function isQuantity(text) {
    return /^\s*\d+(?:\.\d+)?\s*(?:mg|g|kg|ml|l|ltr|litre|liter)\s*$/i.test(
        text
    );
}


function isDateLike(text) {
    const normalized =
        String(text ?? "")
            .replace(/\s+/g, " ")
            .trim();

    const patterns = [
        /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
        /^\d{1,2}[/-]\d{2,4}$/,
        /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[-/][A-Za-z0-9]+$/i,
        /^[A-Za-z]{3,9}\s+\d{2,4}$/i,
        /^[A-Za-z]{3,9}\d{2,4}$/i,
        /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/i
    ];

    return patterns.some(
        (pattern) =>
            pattern.test(normalized)
    );
}


const LOT_STOP_WORDS = new Set([
    "NO",
    "DATE",
    "PACKED",
    "PACK",
    "EXP",
    "EXPIRY",
    "MRP",
    "USP",
    "NET",
    "WEIGHT",
    "QUANTITY",
    "VOLUME",
    "INCLUSIVE",
    "ALL",
    "TAXES",
    "PER",
    "G",
    "ML",
    "KG"
]);


function isLotLike(text) {
    const normalized =
        String(text ?? "")
            .trim();

    if (!normalized) {
        return false;
    }

    if (
        LOT_STOP_WORDS.has(
            normalizeText(normalized)
        )
    ) {
        return false;
    }

    if (
        !/^[A-Za-z0-9][A-Za-z0-9./_-]{1,24}$/.test(
            normalized
        )
    ) {
        return false;
    }

    // Alphabetic-only lot codes are possible, but require a
    // little more length. This rejects common words like
    // "PACKED", "DATE", "INCLUSIVE", etc.
    if (
        /^[A-Za-z]+$/.test(normalized) &&
        normalized.length < 6
    ) {
        return false;
    }

    return true;
}


function valueMatchesField(
    field,
    text
) {
    const type =
        FIELD_DEFINITIONS[field]?.valueType;

    switch (type) {
        case "price":
            return isPrice(text);

        case "quantity":
            return isQuantity(text);

        case "date":
            return isDateLike(text);

        case "lot":
            return isLotLike(text);

        default:
            return false;
    }
}


// ============================================================
// 7. CANDIDATE BOX SANITY CHECK
// ============================================================

function isUsableValueBox(box) {
    if (
        !box ||
        box.width <= 0 ||
        box.height <= 0
    ) {
        return false;
    }

    const verticalRatio =
        box.height /
        Math.max(1, box.width);

    // Reject very tall/narrow OCR regions such as vertical
    // barcode/side-panel text.
    if (
        verticalRatio >
        MAX_VALUE_VERTICAL_RATIO
    ) {
        return false;
    }

    return true;
}


// ============================================================
// 8. VALUE CANDIDATE GENERATION
//
// Generate single-word and short multi-word candidates.
// This lets us handle:
//   "July 2026"
//   "500 ml"
//   "â‚¹ 225.00"
// ============================================================

function getValueCandidates(
    rows,
    labelWordSet
) {
    const candidates = [];

    for (const row of rows) {
        const rowWords = row.words;

        for (
            let start = 0;
            start < rowWords.length;
            start++
        ) {
            const firstWord =
                rowWords[start];

            if (
                labelWordSet.has(
                    firstWord
                )
            ) {
                continue;
            }

            if (
                isPunctuationOnly(
                    firstWord.text
                )
            ) {
                continue;
            }

            let spanWords = [];

            for (
                let length = 1;
                length <= 3;
                length++
            ) {
                if (
                    start + length >
                    rowWords.length
                ) {
                    break;
                }

                const nextWord =
                    rowWords[
                        start + length - 1
                    ];

                if (
                    labelWordSet.has(
                        nextWord
                    )
                ) {
                    break;
                }

                if (
                    length > 1
                ) {
                    const previousWord =
                        rowWords[
                            start + length - 2
                        ];

                    const previousBox =
                        previousWord.boundingBox;

                    const currentBox =
                        nextWord.boundingBox;

                    const gap =
                        currentBox.x -
                        (
                            previousBox.x +
                            previousBox.width
                        );

                    const allowedGap =
                        Math.max(
                            previousBox.height,
                            currentBox.height
                        ) * 2.5;

                    if (
                        gap < -10 ||
                        gap > allowedGap
                    ) {
                        break;
                    }

                    if (
                        !areWordsOnSameRow(
                            previousWord,
                            nextWord
                        )
                    ) {
                        break;
                    }
                }

                spanWords =
                    rowWords.slice(
                        start,
                        start + length
                    );

                const boundingBox =
                    buildBoundingBox(
                        spanWords
                    );

                if (
                    !isUsableValueBox(
                        boundingBox
                    )
                ) {
                    continue;
                }

                const text =
                    spanWords
                        .map(
                            (word) =>
                                word.text
                        )
                        .join(" ");

                const confidence =
                    spanWords.reduce(
                        (sum, word) =>
                            sum +
                            (
                                word.confidence ??
                                0
                            ),
                        0
                    ) /
                    spanWords.length;

                candidates.push({
                    text,
                    confidence,
                    boundingBox,
                    words: spanWords
                });
            }
        }
    }

    return removeDuplicateCandidates(
        candidates
    );
}


function removeDuplicateCandidates(
    candidates
) {
    const unique = [];

    for (const candidate of candidates) {
        const exists =
            unique.some(
                (existing) =>
                    existing.text ===
                        candidate.text &&
                    existing.boundingBox.x ===
                        candidate.boundingBox.x &&
                    existing.boundingBox.y ===
                        candidate.boundingBox.y &&
                    existing.boundingBox.width ===
                        candidate.boundingBox.width &&
                    existing.boundingBox.height ===
                        candidate.boundingBox.height
            );

        if (!exists) {
            unique.push(candidate);
        }
    }

    return unique;
}


// ============================================================
// 9. SAME-ROW LABEL HELPERS
// ============================================================

function labelsAreOnSameRow(
    labelA,
    labelB
) {
    return areWordsOnSameRow(
        {
            boundingBox:
                labelA.boundingBox
        },
        {
            boundingBox:
                labelB.boundingBox
        }
    );
}


function findNextLabelToRight(
    label,
    labels
) {
    const candidates =
        labels.filter(
            (other) => {
                if (
                    other === label ||
                    !labelsAreOnSameRow(
                        label,
                        other
                    )
                ) {
                    return false;
                }

                return (
                    other.boundingBox.x >
                    label.boundingBox.x
                );
            }
        );

    candidates.sort(
        (a, b) =>
            a.boundingBox.x -
            b.boundingBox.x
    );

    return candidates[0] ?? null;
}


// ============================================================
// 10. SPATIAL RELATIONSHIPS
//
// ONLY:
//   RIGHT
//   BELOW
// ============================================================

function getRightRelation(
    label,
    candidate,
    labels
) {
    const labelBox =
        label.boundingBox;

    const valueBox =
        candidate.boundingBox;

    const labelRight =
        labelBox.x +
        labelBox.width;

    const gap =
        valueBox.x -
        labelRight;

    const labelCenterY =
        labelBox.y +
        labelBox.height / 2;

    const valueCenterY =
        valueBox.y +
        valueBox.height / 2;

    const verticalOffset =
        Math.abs(
            valueCenterY -
            labelCenterY
        );

    const maxGap =
        Math.max(
            labelBox.width * 5,
            labelBox.height * 8
        );

    const maxVerticalOffset =
        labelBox.height * 2.2;

    // Slight overlap is allowed for OCR box imperfections.
    if (
        gap <
        -labelBox.width * 0.35
    ) {
        return null;
    }

    if (
        gap >
        maxGap
    ) {
        return null;
    }

    if (
        verticalOffset >
        maxVerticalOffset
    ) {
        return null;
    }

    // Do not allow a candidate to jump over another
    // detected field label on the same row.
    const nextLabel =
        findNextLabelToRight(
            label,
            labels
        );

    if (
        nextLabel &&
        candidate.boundingBox.x >=
            nextLabel.boundingBox.x -
                labelBox.width * 0.35
    ) {
        return null;
    }

    const proximityScore =
        Math.max(
            0,
            1 -
                Math.max(0, gap) /
                    maxGap
        ) * 70;

    const alignmentScore =
        Math.max(
            0,
            1 -
                verticalOffset /
                    maxVerticalOffset
        ) * 80;

    const overlapScore =
        verticalOverlapRatio(
            labelBox,
            valueBox
        ) * 45;

    return {
        direction: "RIGHT",
        score:
            proximityScore +
            alignmentScore +
            overlapScore
    };
}


function getBelowRelation(
    label,
    candidate
) {
    const labelBox =
        label.boundingBox;

    const valueBox =
        candidate.boundingBox;

    const labelBottom =
        labelBox.y +
        labelBox.height;

    const valueCenterX =
        valueBox.x +
        valueBox.width / 2;

    const labelCenterX =
        labelBox.x +
        labelBox.width / 2;

    const gap =
        valueBox.y -
        labelBottom;

    const horizontalOffset =
        Math.abs(
            valueCenterX -
            labelCenterX
        );

    const maxVerticalGap =
        Math.max(
            labelBox.height * 5,
            labelBox.width * 1.5
        );

    // This is intentionally tighter than RIGHT mode.
    // It keeps the working column layout stable.
    const maxHorizontalOffset =
        Math.max(
            labelBox.width * 2,
            labelBox.height * 3
        );

    if (
        gap <
        -labelBox.height * 0.25
    ) {
        return null;
    }

    if (
        gap >
        maxVerticalGap
    ) {
        return null;
    }

    if (
        horizontalOffset >
        maxHorizontalOffset
    ) {
        return null;
    }

    const proximityScore =
        Math.max(
            0,
            1 -
                Math.max(0, gap) /
                    maxVerticalGap
        ) * 70;

    const alignmentScore =
        Math.max(
            0,
            1 -
                horizontalOffset /
                    maxHorizontalOffset
        ) * 80;

    const overlapScore =
        horizontalOverlapRatio(
            labelBox,
            valueBox
        ) * 45;

    return {
        direction: "BELOW",
        score:
            proximityScore +
            alignmentScore +
            overlapScore
    };
}


function horizontalOverlapRatio(
    boxA,
    boxB
) {
    const left =
        Math.max(
            boxA.x,
            boxB.x
        );

    const right =
        Math.min(
            boxA.x + boxA.width,
            boxB.x + boxB.width
        );

    const overlap =
        Math.max(
            0,
            right - left
        );

    return overlap /
        Math.min(
            boxA.width,
            boxB.width
        );
}


// ============================================================
// 11. SCORE A LABEL/VALUE PAIR
// ============================================================

function scoreCandidate(
    label,
    candidate,
    labels
) {
    if (
        !valueMatchesField(
            label.field,
            candidate.text
        )
    ) {
        return null;
    }

    let bestRelation = null;

    // RIGHT
    const rightRelation =
        getRightRelation(
            label,
            candidate,
            labels
        );

    if (rightRelation) {
        bestRelation =
            rightRelation;
    }

    // BELOW
    const belowRelation =
        getBelowRelation(
            label,
            candidate
        );

    if (
        belowRelation &&
        (
            !bestRelation ||
            belowRelation.score >
                bestRelation.score
        )
    ) {
        bestRelation =
            belowRelation;
    }

    if (!bestRelation) {
        return null;
    }

    const score =
        100 +
        bestRelation.score +
        (candidate.confidence ?? 0) * 20;

    if (
        score <
        MIN_ASSOCIATION_SCORE
    ) {
        return null;
    }

    return {
        score,
        relationship:
            bestRelation.direction
    };
}


// ============================================================
// 12. ONE-TO-ONE GLOBAL ASSIGNMENT
//
// A value can belong to only ONE field.
// A field can receive only ONE value.
// ============================================================

function assignValuesToLabels(
    labels,
    candidates
) {
    const assignments = [];

    for (const label of labels) {
        for (
            const candidate of candidates
        ) {
            // Never use a candidate containing a label word.
            const candidateContainsLabelWord =
                candidate.words?.some(
                    (candidateWord) =>
                        labels.some(
                            (otherLabel) =>
                                otherLabel.words?.includes(
                                    candidateWord
                                )
                        )
                );

            if (
                candidateContainsLabelWord
            ) {
                continue;
            }

            const scored =
                scoreCandidate(
                    label,
                    candidate,
                    labels
                );

            if (!scored) {
                continue;
            }

            assignments.push({
                label,
                candidate,
                score: scored.score,
                relationship:
                    scored.relationship
            });
        }
    }

    // Strongest association first.
    assignments.sort(
        (a, b) =>
            b.score - a.score
    );

    const assignedLabels =
        new Set();

    const assignedCandidates =
        new Set();

    const result = [];

    for (
        const assignment of assignments
    ) {
        if (
            assignedLabels.has(
                assignment.label
            )
        ) {
            continue;
        }

        if (
            assignedCandidates.has(
                assignment.candidate
            )
        ) {
            continue;
        }

        assignedLabels.add(
            assignment.label
        );

        assignedCandidates.add(
            assignment.candidate
        );

        result.push(
            assignment
        );
    }

    return result;
}


// ============================================================
// 13. FINAL FIELD EXTRACTION
// ============================================================

function extractFields(words) {
    const rows =
        groupWordsIntoRows(words);

    const labels =
        detectFieldLabels(words);

    // All words participating in labels become protected.
    const labelWordSet =
        new Set(
            labels.flatMap(
                (label) =>
                    label.words || []
            )
        );

    const candidates =
        getValueCandidates(
            rows,
            labelWordSet
        );

    const result = {
        mrp: null,
        mfg: null,
        lotNo: null,
        quantity: null,
        expiryDate: null,
        usp: null
    };

    const assignments =
        assignValuesToLabels(
            labels,
            candidates
        );

    for (
        const assignment of assignments
    ) {
        const {
            label,
            candidate,
            score,
            relationship
        } = assignment;

        result[label.field] = {
            value: candidate.text,
            confidence:
                candidate.confidence,
            score,
            relationship,
            label: label.label,
            matchedAlias:
                label.matchedAlias,
            labelBoundingBox:
                label.boundingBox,
            valueBoundingBox:
                candidate.boundingBox
        };
    }

    return result;
}


// ============================================================
// 14. EXPORTS
// ============================================================

module.exports = {
    detectFieldLabels,
    extractFields
};