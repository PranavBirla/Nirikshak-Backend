const FIELD_ALIASES = {
    mrp: [
        "MRP",
        "M.R.P",
        "M.R.P.",
        "MAXIMUM RETAIL PRICE"
    ],

    lotNo: [
        "LOT",
        "LOT NO",
        "LOT NO.",
        "BATCH",
        "BATCH NO",
        "BATCH NO."
    ],

    quantity: [
        "NET",
        "NET WEIGHT",
        "NET WT",
        "NET QTY",
        "NET QUANTITY",
        "QUANTITY",
        "NET CONTENT",
        "NET CONTENTS",
        "NET VOLUME"
    ],

    mfg: [
        "MFG",
        "MFD",
        "PKD",
        "MANUFACTURED",
        "MANUFACTURING DATE",
        "PACKED ON",
        "PACKAGING DATE",
        "PACKED"
    ],

    expiryDate: [
        "EXPIRY",
        "EXPIRY DATE",
        "EXP",
        "EXP DATE",
        "USE BY",
        "BEST BEFORE",
        "BEST BEFORE DATE"
    ],

    usp: [
        "USP",
        "U.S.P.",
        "UNIT SALE PRICE",
        "UNIT SELLING PRICE"
    ]
};


// ============================================
// 2. TEXT NORMALIZATION
// ============================================

function normalizeText(text) {
    return text
        .toUpperCase()
        .replace(/[.:()[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


// ============================================
// 3. LABEL DETECTION HELPERS
// ============================================

function areOnSameLine(wordA, wordB) {
    const boxA = wordA.boundingBox;
    const boxB = wordB.boundingBox;

    const centerYA = boxA.y + boxA.height / 2;
    const centerYB = boxB.y + boxB.height / 2;

    const difference = Math.abs(centerYA - centerYB);

    const threshold =
        Math.max(boxA.height, boxB.height) * 0.6;

    return difference <= threshold;
}


function areHorizontallyClose(wordA, wordB) {
    const boxA = wordA.boundingBox;
    const boxB = wordB.boundingBox;

    const gap =
        boxB.x - (boxA.x + boxA.width);

    const threshold =
        Math.max(boxA.height, boxB.height) * 2;

    return gap >= -10 && gap <= threshold;
}


// ============================================
// 4. DETECT FIELD LABELS
// ============================================

function detectFieldLabels(words) {
    const sortedWords = [...words].sort((a, b) => {
        if (a.boundingBox.y !== b.boundingBox.y) {
            return a.boundingBox.y - b.boundingBox.y;
        }

        return a.boundingBox.x - b.boundingBox.x;
    });

    const labels = [];
    const usedWordIndexes = new Set();

    for (let i = 0; i < sortedWords.length; i++) {
        if (usedWordIndexes.has(i)) {
            continue;
        }

        for (let length = 3; length >= 1; length--) {
            if (i + length > sortedWords.length) {
                continue;
            }

            const candidateWords =
                sortedWords.slice(i, i + length);

            let valid = true;

            for (let j = 1; j < candidateWords.length; j++) {
                if (
                    !areOnSameLine(
                        candidateWords[0],
                        candidateWords[j]
                    )
                ) {
                    valid = false;
                    break;
                }

                if (
                    !areHorizontallyClose(
                        candidateWords[j - 1],
                        candidateWords[j]
                    )
                ) {
                    valid = false;
                    break;
                }
            }

            if (!valid) {
                continue;
            }

            const combinedText = candidateWords
                .map((word) => word.text)
                .join(" ");

            const normalizedCandidate =
                normalizeText(combinedText);

            for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
                const matchedAlias = aliases.find(
                    (alias) =>
                        normalizeText(alias) ===
                        normalizedCandidate
                );

                if (!matchedAlias) {
                    continue;
                }

                const boundingBoxes =
                    candidateWords.map(
                        (word) => word.boundingBox
                    );

                const minX = Math.min(
                    ...boundingBoxes.map(
                        (box) => box.x
                    )
                );

                const minY = Math.min(
                    ...boundingBoxes.map(
                        (box) => box.y
                    )
                );

                const maxX = Math.max(
                    ...boundingBoxes.map(
                        (box) =>
                            box.x + box.width
                    )
                );

                const maxY = Math.max(
                    ...boundingBoxes.map(
                        (box) =>
                            box.y + box.height
                    )
                );

                const confidence =
                    candidateWords.reduce(
                        (sum, word) =>
                            sum +
                            (word.confidence ?? 0),
                        0
                    ) / candidateWords.length;

                labels.push({
                    field,
                    label: combinedText,
                    confidence,
                    boundingBox: {
                        x: minX,
                        y: minY,
                        width: maxX - minX,
                        height: maxY - minY
                    },
                    words: candidateWords
                });

                for (let j = 0; j < length; j++) {
                    usedWordIndexes.add(i + j);
                }

                break;
            }

            if (usedWordIndexes.has(i)) {
                break;
            }
        }
    }

    return labels;
}


// ============================================
// 5. GEOMETRY HELPERS
// ============================================

function getCenterX(box) {
    return box.x + box.width / 2;
}


function getCenterY(box) {
    return box.y + box.height / 2;
}


function getVerticalOverlapRatio(boxA, boxB) {
    const top = Math.max(
        boxA.y,
        boxB.y
    );

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


function getHorizontalOverlapRatio(boxA, boxB) {
    const left = Math.max(
        boxA.x,
        boxB.x
    );

    const right = Math.min(
        boxA.x + boxA.width,
        boxB.x + boxB.width
    );

    const overlap = Math.max(
        0,
        right - left
    );

    return overlap / Math.min(
        boxA.width,
        boxB.width
    );
}


// ============================================
// 6. VALUE TYPE VALIDATION
// ============================================

function isPrice(text) {
    return /^\s*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d{1,2})?\s*$/i.test(
        text
    );
}


function isQuantity(text) {
    return /^\s*\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|l|litre|liter|ltr)\s*$/i.test(
        text
    );
}


function isDateLike(text) {
    return /^\s*(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}[\/-]\d{2,4}|[A-Za-z]{3,9}\s*\d{2,4}|[A-Za-z]{3,9}\d{2,4})\s*$/i.test(
        text
    );
}


// NOTE:
// This is intentionally permissive for the prototype.
// We will tighten lot/batch validation after testing
// against more real-world package images.
function isLotLike(text) {
    return /^[A-Za-z0-9][A-Za-z0-9/-]{1,20}$/.test(
        text
    );
}


function valueMatchesField(field, text) {
    switch (field) {
        case "mrp":
            return isPrice(text);

        case "quantity":
            return isQuantity(text);

        case "mfg":
        case "expiryDate":
            return isDateLike(text);

        case "lotNo":
            return isLotLike(text);

        case "usp":
            return isPrice(text);

        default:
            return false;
    }
}


// ============================================
// 7. DETERMINE LABEL → VALUE RELATIONSHIP
//
// We intentionally support ONLY:
//      RIGHT
//      BELOW
//
// LEFT and ABOVE are rejected.
// ============================================

function getCandidateRelation(labelBox, valueBox) {
    const scale = Math.max(
        labelBox.width,
        labelBox.height,
        valueBox.width,
        valueBox.height
    );

    const labelRight =
        labelBox.x + labelBox.width;

    const labelBottom =
        labelBox.y + labelBox.height;

    const labelCenterX = getCenterX(labelBox);
    const labelCenterY = getCenterY(labelBox);

    const valueCenterX = getCenterX(valueBox);
    const valueCenterY = getCenterY(valueBox);


    // ----------------------------------------
    // RIGHT RELATIONSHIP
    //
    // MRP : 85.00
    // ----------------------------------------

    const rightGap =
        valueBox.x - labelRight;

    const verticalCenterDistance =
        Math.abs(
            valueCenterY - labelCenterY
        );

    const rightPossible =
        rightGap >= -scale * 0.25 &&
        rightGap <= scale * 5 &&
        verticalCenterDistance <= scale * 2.5;

    if (rightPossible) {
        const distanceScore =
            Math.max(
                0,
                1 -
                    Math.max(0, rightGap) /
                        (scale * 5)
            );

        const alignmentScore =
            Math.max(
                0,
                1 -
                    verticalCenterDistance /
                        (scale * 2.5)
            );

        const overlapScore =
            getVerticalOverlapRatio(
                labelBox,
                valueBox
            );

        return {
            direction: "RIGHT",
            score:
                distanceScore * 60 +
                alignmentScore * 80 +
                overlapScore * 40
        };
    }


    // ----------------------------------------
    // BELOW RELATIONSHIP
    //
    // MRP
    // 85.00
    // ----------------------------------------

    const belowGap =
        valueBox.y - labelBottom;

    const horizontalCenterDistance =
        Math.abs(
            valueCenterX - labelCenterX
        );

    const belowPossible =
        belowGap >= -scale * 0.25 &&
        belowGap <= scale * 5 &&
        horizontalCenterDistance <=
            scale * 3;

    if (belowPossible) {
        const distanceScore =
            Math.max(
                0,
                1 -
                    Math.max(0, belowGap) /
                        (scale * 5)
            );

        const alignmentScore =
            Math.max(
                0,
                1 -
                    horizontalCenterDistance /
                        (scale * 3)
            );

        const overlapScore =
            getHorizontalOverlapRatio(
                labelBox,
                valueBox
            );

        return {
            direction: "BELOW",
            score:
                distanceScore * 60 +
                alignmentScore * 80 +
                overlapScore * 40
        };
    }

    return null;
}


// ============================================
// 8. SCORE A LABEL/VALUE PAIR
// ============================================

function scoreCandidate(label, candidate) {
    // HARD GATE #1:
    // Candidate must have the correct value type.
    if (
        !valueMatchesField(
            label.field,
            candidate.text
        )
    ) {
        return -Infinity;
    }

    // HARD GATE #2:
    // Candidate must be RIGHT or BELOW
    // and close enough.
    const relation = getCandidateRelation(
        label.boundingBox,
        candidate.boundingBox
    );

    if (!relation) {
        return -Infinity;
    }

    // Base field-type score.
    let score = 100;

    // Spatial score.
    score += relation.score;

    // Small preference for better OCR confidence.
    score +=
        (candidate.confidence ?? 0) * 20;

    return score;
}


// ============================================
// 9. GLOBAL ONE-TO-ONE ASSIGNMENT
//
// We do NOT let every field independently
// steal the same OCR value.
//
// Highest-scoring associations are assigned first.
// Once a value is used, it is unavailable.
// ============================================

function assignValuesToLabels(labels, words) {
    const assignments = [];

    for (const label of labels) {
        for (const word of words) {

            // Never use a word that is itself part
            // of the detected label.
            const isLabelWord =
                label.words?.some(
                    (labelWord) =>
                        labelWord.boundingBox.x ===
                            word.boundingBox.x &&
                        labelWord.boundingBox.y ===
                            word.boundingBox.y
                );

            if (isLabelWord) {
                continue;
            }

            const score = scoreCandidate(
                label,
                word
            );

            if (score === -Infinity) {
                continue;
            }

            assignments.push({
                label,
                word,
                score,
                relationship:
                    getCandidateRelation(
                        label.boundingBox,
                        word.boundingBox
                    )?.direction ?? null
            });
        }
    }


    // Highest-quality associations first.
    assignments.sort(
        (a, b) => b.score - a.score
    );


    const assignedLabels =
        new Set();

    const assignedWords =
        new Set();

    const result = [];


    for (const assignment of assignments) {
        // One field gets one value.
        if (
            assignedLabels.has(
                assignment.label
            )
        ) {
            continue;
        }

        // One OCR value gets one field.
        if (
            assignedWords.has(
                assignment.word
            )
        ) {
            continue;
        }

        assignedLabels.add(
            assignment.label
        );

        assignedWords.add(
            assignment.word
        );

        result.push({
            label: assignment.label,
            value: assignment.word.text,
            confidence:
                assignment.word.confidence,
            score: assignment.score,
            relationship:
                assignment.relationship,
            boundingBox:
                assignment.word.boundingBox
        });
    }

    return result;
}


// ============================================
// 10. EXTRACT ALL FIELDS
// ============================================

function extractFields(words) {
    const labels =
        detectFieldLabels(words);

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
            words
        );


    for (const assignment of assignments) {
        const {
            label,
            value,
            confidence,
            score,
            relationship,
            boundingBox
        } = assignment;

        result[label.field] = {
            value,
            confidence,
            score,
            relationship,
            label: label.label,
            labelBoundingBox:
                label.boundingBox,
            valueBoundingBox:
                boundingBox
        };
    }

    return result;
}


// ============================================
// 11. EXPORTS
// ============================================

module.exports = {
    detectFieldLabels,
    extractFields
};