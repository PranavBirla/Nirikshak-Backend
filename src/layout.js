function groupWordsIntoLines(words) {
    const lines = [];

    for (const word of words) {
        const box = word.boundingBox;

        const wordCenterY = box.y + box.height / 2;

        // Find an existing line whose vertical center is close enough
        let bestLine = null;
        let smallestDifference = Infinity;

        for (const line of lines) {
            const difference = Math.abs(wordCenterY - line.centerY);

            // Adaptive threshold based on the word's height
            const threshold = Math.max(box.height, line.averageHeight) * 0.6;

            if (difference <= threshold && difference < smallestDifference) {
                bestLine = line;
                smallestDifference = difference;
            }
        }

        if (bestLine) {
            bestLine.words.push(word);

            // Update line statistics
            const totalHeight =
                bestLine.averageHeight * (bestLine.words.length - 1);

            bestLine.averageHeight =
                (totalHeight + box.height) / bestLine.words.length;

            bestLine.centerY =
                bestLine.words.reduce(
                    (sum, currentWord) =>
                        sum +
                        currentWord.boundingBox.y +
                        currentWord.boundingBox.height / 2,
                    0
                ) / bestLine.words.length;
        } else {
            lines.push({
                centerY: wordCenterY,
                averageHeight: box.height,
                words: [word]
            });
        }
    }

    // Sort words from left → right inside each line
    for (const line of lines) {
        line.words.sort(
            (a, b) => a.boundingBox.x - b.boundingBox.x
        );
    }

    // Sort lines from top → bottom
    lines.sort((a, b) => a.centerY - b.centerY);

    // Convert internal representation into clean output
    return lines.map((line) => {
        const words = line.words;

        const minX = Math.min(
            ...words.map((word) => word.boundingBox.x)
        );

        const minY = Math.min(
            ...words.map((word) => word.boundingBox.y)
        );

        const maxX = Math.max(
            ...words.map(
                (word) =>
                    word.boundingBox.x +
                    word.boundingBox.width
            )
        );

        const maxY = Math.max(
            ...words.map(
                (word) =>
                    word.boundingBox.y +
                    word.boundingBox.height
            )
        );

        return {
            text: words.map((word) => word.text).join(" "),
            confidence:
                words.reduce(
                    (sum, word) =>
                        sum +
                        (word.confidence ?? 0),
                    0
                ) / words.length,
            boundingBox: {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            },
            words
        };
    });
}

module.exports = {
    groupWordsIntoLines
};