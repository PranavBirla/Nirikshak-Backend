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
        "NET CONTENTS"
    ],

    mfg: [
        "MFG",
        "MFD",
        "MANUFACTURED",
        "MANUFACTURING DATE",
        "PACKED ON",
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


function normalizeText(text) {
    return text
        .toUpperCase()
        .replace(/[.:()[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


// Check whether two words are visually on the same line.
function areOnSameLine(wordA, wordB) {
    const boxA = wordA.boundingBox;
    const boxB = wordB.boundingBox;

    const centerYA = boxA.y + boxA.height / 2;
    const centerYB = boxB.y + boxB.height / 2;

    const difference = Math.abs(centerYA - centerYB);

    const threshold = Math.max(boxA.height, boxB.height) * 0.6;

    return difference <= threshold;
}


// Check whether wordB is reasonably close to wordA horizontally.
function areHorizontallyClose(wordA, wordB) {
    const boxA = wordA.boundingBox;
    const boxB = wordB.boundingBox;

    const gap = boxB.x - (boxA.x + boxA.width);

    const threshold = Math.max(boxA.height, boxB.height) * 2;

    return gap >= -10 && gap <= threshold;
}


function detectFieldLabels(words) {
    // Work with left-to-right words.
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

        const currentWord = sortedWords[i];

        // Try combinations of 1, 2 and 3 consecutive words.
        for (let length = 3; length >= 1; length--) {
            if (i + length > sortedWords.length) {
                continue;
            }

            const candidateWords = sortedWords.slice(i, i + length);

            // Every word must be on the same visual line.
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

            const normalizedCandidate = normalizeText(combinedText);

            for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
                const matchedAlias = aliases.find(
                    (alias) =>
                        normalizeText(alias) === normalizedCandidate
                );

                if (!matchedAlias) {
                    continue;
                }

                const boundingBoxes = candidateWords.map(
                    (word) => word.boundingBox
                );

                const minX = Math.min(
                    ...boundingBoxes.map((box) => box.x)
                );

                const minY = Math.min(
                    ...boundingBoxes.map((box) => box.y)
                );

                const maxX = Math.max(
                    ...boundingBoxes.map(
                        (box) => box.x + box.width
                    )
                );

                const maxY = Math.max(
                    ...boundingBoxes.map(
                        (box) => box.y + box.height
                    )
                );

                const confidence =
                    candidateWords.reduce(
                        (sum, word) =>
                            sum + (word.confidence ?? 0),
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



function getCenterX(box) {
    return box.x + box.width / 2;
}

function getCenterY(box) {
    return box.y + box.height / 2;
}

function horizontalOverlapRatio(labelBox, valueBox) {
    const labelLeft = labelBox.x;
    const labelRight = labelBox.x + labelBox.width;

    const valueLeft = valueBox.x;
    const valueRight = valueBox.x + valueBox.width;

    const overlapStart = Math.max(labelLeft, valueLeft);
    const overlapEnd = Math.min(labelRight, valueRight);

    const overlap = Math.max(0, overlapEnd - overlapStart);

    const labelWidth = labelBox.width;

    return overlap / labelWidth;
}


function horizontalCenterDistance(labelBox, valueBox) {
    const labelCenter = labelBox.x + labelBox.width / 2;
    const valueCenter = valueBox.x + valueBox.width / 2;

    return Math.abs(labelCenter - valueCenter);
}


function verticalDistance(labelBox, valueBox) {
    const labelBottom = labelBox.y + labelBox.height;
    return Math.max(0, valueBox.y - labelBottom);
}


function isPrice(text) {
    return /^\s*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d{1,2})?\s*$/i.test(text);
}


function isQuantity(text) {
    return /^\s*\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|l|litre|liter|ltr)\s*$/i.test(text);
}


function isDateLike(text) {
    return /^\s*(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}[\/-]\d{2,4}|[A-Za-z]{3,9}\s*\d{2,4}|[A-Za-z]{3,9}\d{2,4})\s*$/i.test(text);
}


function isLotLike(text) {
    return /^[A-Za-z0-9][A-Za-z0-9/-]{1,20}$/.test(text);
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

function getBoxGapDistance(boxA, boxB) {
    const horizontalGap = Math.max(
        boxA.x - (boxB.x + boxB.width),
        boxB.x - (boxA.x + boxA.width),
        0
    );

    const verticalGap = Math.max(
        boxA.y - (boxB.y + boxB.height),
        boxB.y - (boxA.y + boxA.height),
        0
    );

    return Math.sqrt(
        horizontalGap ** 2 +
        verticalGap ** 2
    );
}


function isCandidateNearLabel(labelBox, valueBox) {
    const scale = Math.max(
        labelBox.width,
        labelBox.height,
        valueBox.width,
        valueBox.height
    );

    // Initial adaptive proximity radius.
    const maxDistance = scale * 2.5;

    const distance = getBoxGapDistance(
        labelBox,
        valueBox
    );

    return distance <= maxDistance;
}

const MAX_NORMALIZED_DISTANCE = 3.0;


function getSpatialRelationship(labelBox, valueBox) {
    const labelCenterX = getCenterX(labelBox);
    const labelCenterY = getCenterY(labelBox);

    const valueCenterX = getCenterX(valueBox);
    const valueCenterY = getCenterY(valueBox);

    const dx = valueCenterX - labelCenterX;
    const dy = valueCenterY - labelCenterY;

    const scale = Math.max(
        labelBox.width,
        labelBox.height,
        valueBox.width,
        valueBox.height
    );

    const normalizedDistance =
        Math.sqrt(dx * dx + dy * dy) / scale;

    let direction;

    // Decide whether the relationship is primarily
    // horizontal or vertical.
    if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        direction = dx > 0 ? "RIGHT" : "LEFT";
    } else {
        direction = dy > 0 ? "BELOW" : "ABOVE";
    }

    return {
        direction,
        normalizedDistance,
        dx,
        dy,
        scale
    };
}


function getVerticalOverlapRatio(boxA, boxB) {
    const top = Math.max(boxA.y, boxB.y);

    const bottom = Math.min(
        boxA.y + boxA.height,
        boxB.y + boxB.height
    );

    const overlap = Math.max(0, bottom - top);

    return overlap / Math.min(
        boxA.height,
        boxB.height
    );
}


function getHorizontalOverlapRatio(boxA, boxB) {
    const left = Math.max(boxA.x, boxB.x);

    const right = Math.min(
        boxA.x + boxA.width,
        boxB.x + boxB.width
    );

    const overlap = Math.max(0, right - left);

    return overlap / Math.min(
        boxA.width,
        boxB.width
    );
}


function isCandidateNearLabel(labelBox, valueBox) {
    const spatial = getSpatialRelationship(
        labelBox,
        valueBox
    );

    return (
        spatial.normalizedDistance <=
        MAX_NORMALIZED_DISTANCE
    );
}


function scoreCandidate(label, candidate) {
    const labelBox = label.boundingBox;
    const valueBox = candidate.boundingBox;

    // --------------------------------------------------
    // HARD GATE #1
    // Candidate must be a valid value type.
    // --------------------------------------------------

    const fieldPatternMatch = valueMatchesField(
        label.field,
        candidate.text
    );

    if (!fieldPatternMatch) {
        return -Infinity;
    }


    // --------------------------------------------------
    // HARD GATE #2
    // Candidate must actually be close.
    // --------------------------------------------------

    const spatial = getSpatialRelationship(
        labelBox,
        valueBox
    );

    if (
        spatial.normalizedDistance >
        MAX_NORMALIZED_DISTANCE
    ) {
        return -Infinity;
    }


    let score = 100;


    // --------------------------------------------------
    // 1. Proximity
    // Closer candidate = higher score.
    // --------------------------------------------------

    const proximityScore =
        (
            1 -
            spatial.normalizedDistance /
            MAX_NORMALIZED_DISTANCE
        ) * 100;

    score += Math.max(
        0,
        proximityScore
    );


    // --------------------------------------------------
    // 2. Alignment
    //
    // For horizontal relationships:
    // we care about vertical alignment.
    //
    // For vertical relationships:
    // we care about horizontal alignment.
    // --------------------------------------------------

    if (
        spatial.direction === "LEFT" ||
        spatial.direction === "RIGHT"
    ) {
        const verticalOffset =
            Math.abs(spatial.dy) /
            spatial.scale;

        const alignmentScore =
            Math.max(
                0,
                1 - verticalOffset
            ) * 60;

        score += alignmentScore;

        // Extra bonus when the two boxes
        // actually overlap vertically.
        score +=
            getVerticalOverlapRatio(
                labelBox,
                valueBox
            ) * 40;

    } else {

        const horizontalOffset =
            Math.abs(spatial.dx) /
            spatial.scale;

        const alignmentScore =
            Math.max(
                0,
                1 - horizontalOffset
            ) * 60;

        score += alignmentScore;

        // Extra bonus when the two boxes
        // actually overlap horizontally.
        score +=
            getHorizontalOverlapRatio(
                labelBox,
                valueBox
            ) * 40;
    }


    return score;
}


function findBestValue(label, words) {
    let bestCandidate = null;
    let bestScore = -Infinity;

    for (const word of words) {
        // Don't treat the label itself as its value.
        if (
            word.boundingBox.x === label.boundingBox.x &&
            word.boundingBox.y === label.boundingBox.y
        ) {
            continue;
        }

        const score = scoreCandidate(label, word);

        if (score > bestScore) {
            bestScore = score;
            bestCandidate = word;
        }
    }

    if (!bestCandidate || bestScore === -Infinity) {
        return null;
    }

    return {
        value: bestCandidate.text,
        confidence: bestCandidate.confidence,
        score: bestScore,
        boundingBox: bestCandidate.boundingBox
    };
}

function assignValuesToLabels(labels, words) {
    const assignments = [];

    for (const label of labels) {
        for (const word of words) {
            // Don't use words that belong to the label itself
            const isLabelWord = label.words?.some(
                (labelWord) =>
                    labelWord.boundingBox.x === word.boundingBox.x &&
                    labelWord.boundingBox.y === word.boundingBox.y
            );

            if (isLabelWord) {
                continue;
            }

            const score = scoreCandidate(label, word);

            if (score === -Infinity) {
                continue;
            }

            assignments.push({
                label,
                word,
                score
            });
        }
    }

    // Highest-quality associations get priority.
    assignments.sort((a, b) => b.score - a.score);

    const assignedLabels = new Set();
    const assignedWords = new Set();

    const result = [];

    for (const assignment of assignments) {
        if (assignedLabels.has(assignment.label)) {
            continue;
        }

        if (assignedWords.has(assignment.word)) {
            continue;
        }

        assignedLabels.add(assignment.label);
        assignedWords.add(assignment.word);

        result.push({
            label: assignment.label,
            value: assignment.word.text,
            confidence: assignment.word.confidence,
            score: assignment.score,
            boundingBox: assignment.word.boundingBox
        });
    }

    return result;
}

function extractFields(words) {
    const labels = detectFieldLabels(words);

    const result = {
        mrp: null,
        mfg: null,
        lotNo: null,
        quantity: null,
        expiryDate: null,
        usp: null
    };

    const assignments = assignValuesToLabels(
        labels,
        words
    );

    for (const assignment of assignments) {
        const {
            label,
            value,
            confidence,
            score,
            boundingBox
        } = assignment;

        result[label.field] = {
            value,
            confidence,
            score,
            label: label.label,
            labelBoundingBox: label.boundingBox,
            valueBoundingBox: boundingBox
        };
    }

    return result;
}


module.exports = {
    detectFieldLabels,
    extractFields
};