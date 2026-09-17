function checkField(field) {
    if (!field) {
        return "NOT_DETECTED";
    }

    if (!field.value || field.value.trim() === "") {
        return "NOT_DETECTED";
    }

    return "PRESENT";
}


function checkCompliance(fields) {
    return {
        mrp: checkField(fields.mrp),
        mfg: checkField(fields.mfg),
        lotNo: checkField(fields.lotNo),
        quantity: checkField(fields.quantity),
        expiryDate: checkField(fields.expiryDate),
        usp: checkField(fields.usp)
    };
}


module.exports = {
    checkCompliance
};