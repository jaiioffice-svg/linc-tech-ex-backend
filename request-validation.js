function invalidRequest(res, code, message) {
    return res.status(400).json({
        success: false,
        code,
        message
    });
}

function validateUserRequest(req, res, next) {
    const body = req.body === undefined ? {} : req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return invalidRequest(
            res,
            'INVALID_BODY',
            'Request body must be a JSON object'
        );
    }

    if (body.userId !== undefined) {
        if (
            typeof body.userId !== 'string' ||
            !body.userId.trim() ||
            body.userId.length > 200
        ) {
            return invalidRequest(
                res,
                'INVALID_USER_ID',
                'userId must be a non-empty string of at most 200 characters'
            );
        }
    }

    if (body.grade !== undefined) {
        if (
            typeof body.grade !== 'string' ||
            body.grade.length > 32
        ) {
            return invalidRequest(
                res,
                'INVALID_GRADE',
                'grade must be a string of at most 32 characters'
            );
        }
    }

    return next();
}

module.exports = {
    validateUserRequest
};
