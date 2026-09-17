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
            "BATCH NO.",
            "BATCH NUMBER"
        ],
        valueType: "lot"
    },

    quantity: {
        aliases: [
            "NET",
            "NET WEIGHT",
            "NET WT",
            "NET QTY",
            "NET QUANTITY",
            "NET CONTENT",
            "NET CONTENTS",
            "NET VOLUME",
            "QUANTITY",
            "VOLUME"
        ],
        valueType: "quantity"
    },

    mfg: {
        aliases: [
            "MFG",
            "MFD",
            "MFG DATE",
            "MFG. DATE",
            "MFD DATE",
            "MFD. DATE",
            "MANUFACTURED",
            "MANUFACTURING DATE",
            "PACKED ON",
            "PACKAGING DATE",
            "PKD"
        ],
        valueType: "date"
    },

    expiryDate: {
        aliases: [
            "EXPIRY",
            "EXPIRY DATE",
            "EXP",
            "EXP DATE",
            "EXP. DATE",
            "USE BY",
            "BEST BEFORE",
            "BEST BEFORE DATE"
        ],
        valueType: "date"
    },

    usp: {
        aliases: [
            "USP",
            "U.S.P",
            "U.S.P.",
            "UNIT SALE PRICE",
            "UNIT SELLING PRICE",
            "USP PER ML",
            "USP PER G",
            "USP PER KG",
            "USP PER L"
        ],
        valueType: "price"
    }
};


// ============================================================
// 2. TUNING CONSTANTS
// ============================================================

const MAX_LABEL_WORDS = 5;

// Very tall/narrow OCR boxes are commonly barcode/side-panel text.
const MAX_VALUE_VERTICAL_RATIO = 4.5;

// A match below this score is not trusted.
const MIN_ASSOCIATION_SCORE = 170;

// RIGHT: value is on the same visual row as the label.
const RIGHT_MAX_GAP_HEIGHT_MULTIPLIER = 6;
const RIGHT_MAX_GAP_WIDTH_MULTIPLIER = 3;
const RIGHT_MAX_VERTICAL_OFFSET_MULTIPLIER = 2.5;

// BELOW: used primarily for column-style labels/values.
const BELOW_MAX_GAP_HEIGHT_MULTIPLIER = 6;
const BELOW_MAX_GAP_WIDTH_MULTIPLIER = 2;
const BELOW_MAX_HORIZONTAL_OFFSET_MULTIPLIER = 3.0;


// ============================================================
// 3. TEXT HELPERS
// ============================================================

function normalizeText(text) {
    return String(text ?? "")
        .toUpperCase()
        .replace(/₹/g, "")
        .replace(/[.:()[\],]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


function compactValueText(text) {
    return String(text ?? "")
        .replace(/\s+/g, " ")
        .replace(/\s*([/:_-])\s*/g, "$1")
        .replace(/₹\s+/g, "₹")
        .trim();
}


function normalizeValueForType(field, text) {
    const compact = compactValueText(text);

    if (field === "lotNo") {
        return compact
            .replace(/\s+/g, "")
            .toUpperCase();
    }

    if (field === "quantity") {
        return compact.replace(/\s+(?=(MG|G|KG|ML|L|LTR)\b)/i, "");
    }

    return compact;
}


function isPunctuationOnly(text) {
    return /^[^A-Z0-9]+$/i.test(
        String(text ?? "").trim()
    );
}


// ============================================================
// 4. ROW GROUPING
// ============================================================

function verticalOverlapRatio(boxA, boxB) {
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

    return (
        verticalOverlapRatio(boxA, boxB) >= 0.15 ||
        centerDifference <= maxHeight * 0.9
    );
}


function groupWordsIntoRows(words) {
    const sortedWords = [...words]
        .filter(
            (word) =>
                word &&
                word.boundingBox &&
                Number.isFinite(word.boundingBox.x) &&
                Number.isFinite(word.boundingBox.y) &&
                Number.isFinite(word.boundingBox.width) &&
                Number.isFinite(word.boundingBox.height)
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
            if (
                !areWordsOnSameRow(
                    word,
                    row.anchorWord
                )
            ) {
                continue;
            }

            const difference =
                Math.abs(
                    wordCenterY -
                    row.centerY
                );

            if (
                difference <
                smallestDifference
            ) {
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
            a.centerY -
            b.centerY
    );

    rows.forEach(
        (row, index) => {
            row.id = index;
        }
    );

    return rows;
}


// ============================================================
// 5. BOX HELPERS
// ============================================================

function buildBoundingBox(words) {
    const boxes =
        words.map(
            (word) =>
                word.boundingBox
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


function getCenterX(box) {
    return box.x + box.width / 2;
}


function getCenterY(box) {
    return box.y + box.height / 2;
}


function horizontalOverlapRatio(boxA, boxB) {
    const left = Math.max(
        boxA.x,
        boxB.x
    );

    const right = Math.min(
        boxA.x + boxA.width,
        boxB.x + boxB.width
    );

    const overlap =
        Math.max(
            0,
            right - left
        );

    return overlap / Math.min(
        boxA.width,
        boxB.width
    );
}


// ============================================================
// 6. LABEL DETECTION
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
                .map(
                    (word) =>
                        word.text
                )
                .join(" ")
        );

    // A bare "NET" is too ambiguous.
    if (
        field === "quantity" &&
        normalized === "NET"
    ) {
        return false;
    }

    // Do not treat "Mfd. By" or "Mfd. Lic." as MFG DATE.
    if (field === "mfg") {
        const afterWords =
            rowWords
                .slice(
                    startIndex +
                        candidateWords.length,
                    startIndex +
                        candidateWords.length +
                        4
                )
                .filter(
                    (word) =>
                        !isPunctuationOnly(
                            word.text
                        )
                )
                .map(
                    (word) =>
                        normalizeText(
                            word.text
                        )
                );

        if (
            afterWords.includes("BY") ||
            afterWords.includes("LIC") ||
            afterWords.includes("LICENSE") ||
            afterWords.includes("LICNO") ||
            afterWords.includes("LICNO")
        ) {
            return false;
        }
    }

    return true;
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
                        rowId: row.id,
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

                    start +=
                        length - 1;

                    break;
                }

                breakIfLabelFound:
                if (
                    labels.length > 0 &&
                    labels[labels.length - 1]
                        .rowId === row.id &&
                    labels[labels.length - 1]
                        .boundingBox.x ===
                        candidateWords[0]
                            .boundingBox.x &&
                    labels[labels.length - 1]
                        .boundingBox.y ===
                        candidateWords[0]
                            .boundingBox.y
                ) {
                    break;
                }
            }
        }
    }

    return removeDuplicateLabels(
        labels
    );
}


function removeDuplicateLabels(labels) {
    const unique = [];

    for (const label of labels) {
        const exists =
            unique.some(
                (existing) =>
                    existing.field ===
                        label.field &&
                    existing.boundingBox.x ===
                        label.boundingBox.x &&
                    existing.boundingBox.y ===
                        label.boundingBox.y &&
                    existing.boundingBox.width ===
                        label.boundingBox.width &&
                    existing.boundingBox.height ===
                        label.boundingBox.height
            );

        if (!exists) {
            unique.push(label);
        }
    }

    return unique;
}


// ============================================================
// 7. VALUE VALIDATORS
// ============================================================

function parseNumericPrice(text) {
    let cleaned =
        String(text ?? "")
            .toUpperCase()
            .replace(/₹/g, "")
            .replace(/\bRS\.?\b/g, "")
            .replace(/\bINR\b/g, "")
            .replace(/,/g, "")
            .trim();

    if (
        !/^\d+(?:\.\d{1,2})?$/.test(
            cleaned
        )
    ) {
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
            .trim();

    const hasCurrency =
        /₹|\bRS\.?\b|\bINR\b/i.test(
            normalized
        );

    // A bare four-digit number is much more
    // likely to be a year / code than a price.
    // A currency-marked four-digit price is allowed.
    if (
        /^\d{4}$/.test(normalized) &&
        !hasCurrency
    ) {
        return false;
    }

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


const LOT_STOP_WORDS =
    new Set([
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
        "KG",
        "JULY",
        "JUNE",
        "MARCH",
        "APRIL",
        "MAY",
        "JANUARY",
        "FEBRUARY",
        "AUGUST",
        "SEPTEMBER",
        "OCTOBER",
        "NOVEMBER",
        "DECEMBER"
    ]);


function isLotLike(text) {
    const normalized =
        String(text ?? "")
            .trim()
            .replace(/\s*([/._-])\s*/g, "$1");

    if (!normalized) {
        return false;
    }

    const upper =
        normalizeText(
            normalized
        );

    if (
        LOT_STOP_WORDS.has(upper)
    ) {
        return false;
    }

    if (
        !/^[A-Za-z0-9][A-Za-z0-9./_-]{1,30}$/.test(
            normalized
        )
    ) {
        return false;
    }

    // Pure numbers of 1-4 digits are more likely
    // prices/years than batch numbers.
    if (
        /^\d{1,4}$/.test(
            normalized
        )
    ) {
        return false;
    }

    // Short alphabetic words are usually labels,
    // not lot numbers.
    if (
        /^[A-Za-z]+$/.test(
            normalized
        ) &&
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
        FIELD_DEFINITIONS[field]
            ?.valueType;

    const normalized =
        normalizeValueForType(
            field,
            text
        );

    switch (type) {
        case "price":
            return isPrice(
                normalized
            );

        case "quantity":
            return isQuantity(
                normalized
            );

        case "date":
            return isDateLike(
                normalized
            );

        case "lot":
            return isLotLike(
                normalized
            );

        default:
            return false;
    }
}


// ============================================================
// 8. VALUE CANDIDATE GENERATION
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
        Math.max(
            1,
            box.width
        );

    return (
        verticalRatio <=
        MAX_VALUE_VERTICAL_RATIO
    );
}


function canJoinWords(
    previousWord,
    currentWord
) {
    if (
        !areWordsOnSameRow(
            previousWord,
            currentWord
        )
    ) {
        return false;
    }

    const previousBox =
        previousWord.boundingBox;

    const currentBox =
        currentWord.boundingBox;

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
        ) * 3;

    return (
        gap >= -10 &&
        gap <= allowedGap
    );
}


function joinValueWords(words) {
    let result = "";

    for (
        let i = 0;
        i < words.length;
        i++
    ) {
        const current =
            words[i].text;

        if (i === 0) {
            result = current;
            continue;
        }

        const previous =
            words[i - 1].text;

        const needsSpace =
            !/^[./,:;)\]}_-]/.test(
                current
            ) &&
            !/[(\[{₹/@_-]$/.test(
                previous
            );

        result +=
            needsSpace
                ? ` ${current}`
                : current;
    }

    return compactValueText(
        result
    );
}


function getValueCandidates(
    rows,
    labelWordSet
) {
    const candidates = [];

    for (const row of rows) {
        const rowWords =
            row.words;

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

            const span = [];

            for (
                let length = 1;
                length <= 5;
                length++
            ) {
                const index =
                    start + length - 1;

                if (
                    index >=
                    rowWords.length
                ) {
                    break;
                }

                const currentWord =
                    rowWords[index];

                if (
                    labelWordSet.has(
                        currentWord
                    )
                ) {
                    break;
                }

                if (
                    span.length > 0 &&
                    !canJoinWords(
                        span[span.length - 1],
                        currentWord
                    )
                ) {
                    break;
                }

                span.push(
                    currentWord
                );

                const boundingBox =
                    buildBoundingBox(
                        span
                    );

                if (
                    !isUsableValueBox(
                        boundingBox
                    )
                ) {
                    continue;
                }

                const text =
                    joinValueWords(
                        span
                    );

                if (
                    !text ||
                    isPunctuationOnly(
                        text
                    )
                ) {
                    continue;
                }

                candidates.push({
                    text,
                    confidence:
                        span.reduce(
                            (sum, word) =>
                                sum +
                                (
                                    word.confidence ??
                                    0
                                ),
                            0
                        ) /
                        span.length,
                    boundingBox,
                    words: [...span],
                    rowId: row.id
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
                    existing.rowId ===
                        candidate.rowId &&
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
// 9. LABEL / CANDIDATE RELATIONSHIPS
// ============================================================

function getNextLabelToRight(
    label,
    labels
) {
    const sameRow =
        labels.filter(
            (other) =>
                other !== label &&
                other.rowId ===
                    label.rowId &&
                other.boundingBox.x >
                    label.boundingBox.x
        );

    sameRow.sort(
        (a, b) =>
            a.boundingBox.x -
            b.boundingBox.x
    );

    return (
        sameRow[0] ??
        null
    );
}


function getRightRelation(
    label,
    candidate,
    labels
) {
    if (
        label.rowId !==
        candidate.rowId
    ) {
        return null;
    }

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

    const verticalOffset =
        Math.abs(
            getCenterY(valueBox) -
            getCenterY(labelBox)
        );

    const maxGap = Math.max(
        labelBox.height *
            RIGHT_MAX_GAP_HEIGHT_MULTIPLIER,
        labelBox.width *
            RIGHT_MAX_GAP_WIDTH_MULTIPLIER
    );

    const maxVerticalOffset =
        labelBox.height *
        RIGHT_MAX_VERTICAL_OFFSET_MULTIPLIER;

    // A little overlap is tolerated for OCR box noise.
    if (
        gap <
        -labelBox.height * 0.75
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

    // Do not jump over the next detected field label.
    const nextLabel =
        getNextLabelToRight(
            label,
            labels
        );

    if (
        nextLabel &&
        candidate.boundingBox.x >=
            nextLabel.boundingBox.x -
                labelBox.height * 0.5
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
        ) * 90;

    const overlapScore =
        verticalOverlapRatio(
            labelBox,
            valueBox
        ) * 45;

    // Same-row RIGHT receives a strong
    // preference over long-distance BELOW.
    const sameRowBonus = 55;

    return {
        direction: "RIGHT",
        score:
            sameRowBonus +
            proximityScore +
            alignmentScore +
            overlapScore
    };
}


function getBelowRelation(
    label,
    candidate
) {
    if (
        candidate.rowId <=
        label.rowId
    ) {
        return null;
    }

    const labelBox =
        label.boundingBox;

    const valueBox =
        candidate.boundingBox;

    const labelBottom =
        labelBox.y +
        labelBox.height;

    const gap =
        valueBox.y -
        labelBottom;

    const horizontalCenterOffset =
        Math.abs(
            getCenterX(valueBox) -
            getCenterX(labelBox)
        );

    const maxVerticalGap =
        Math.max(
            labelBox.height *
                BELOW_MAX_GAP_HEIGHT_MULTIPLIER,
            labelBox.width *
                BELOW_MAX_GAP_WIDTH_MULTIPLIER
        );

    const maxHorizontalOffset =
        Math.max(
            labelBox.width *
                BELOW_MAX_HORIZONTAL_OFFSET_MULTIPLIER,
            labelBox.height * 5
        );

    if (
        gap <
        -labelBox.height * 0.4
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
        horizontalCenterOffset >
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
                horizontalCenterOffset /
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


// ============================================================
// 10. SCORE A LABEL / VALUE PAIR
// ============================================================

function scoreCandidate(
    label,
    candidate,
    labels
) {
    const normalizedValue =
        normalizeValueForType(
            label.field,
            candidate.text
        );

    if (
        !valueMatchesField(
            label.field,
            normalizedValue
        )
    ) {
        return null;
    }

    let bestRelation = null;

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

    // OCR confidence is useful, but it should
    // never overpower spatial structure.
    const score =
        100 +
        bestRelation.score +
        (candidate.confidence ?? 0) *
            15;

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
// 11. GLOBAL ONE-TO-ONE ASSIGNMENT
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
            // A candidate containing any protected
            // label word can never be a value.
            const containsLabelWord =
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
                containsLabelWord
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
                score:
                    scored.score,
                relationship:
                    scored.relationship
            });
        }
    }

    // Strongest label/value relationship first.
    assignments.sort(
        (a, b) =>
            b.score -
            a.score
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
// 12. FINAL EXTRACTION
// ============================================================

function extractFields(words) {
    const rows =
        groupWordsIntoRows(words);

    const labels =
        detectFieldLabels(words);

    // Everything participating in a label is protected.
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

        const value =
            normalizeValueForType(
                label.field,
                candidate.text
            );

        result[label.field] = {
            value,
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
// 13. EXPORTS
// ============================================================

module.exports = {
    detectFieldLabels,
    extractFields
};