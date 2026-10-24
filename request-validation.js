const DEFAULT_ALLOWED_FIELDS = new Set(['userId', 'grade']);
const ALLOWED_FIELDS_BY_PATH = {
    '/api/v1/users/register': DEFAULT_ALLOWED_FIELDS,
    '/api/v1/heartbeat': DEFAULT_ALLOWED_FIELDS,
    '/api/v1/alert/delete': new Set(['userId'])
};

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

    const allowedFields = ALLOWED_FIELDS_BY_PATH[req.path] || DEFAULT_ALLOWED_FIELDS;
    const unsupportedField = Object.keys(body).find(key => !allowedFields.has(key));
    if (unsupportedField !== undefined) {
        return invalidRequest(
            res,
            'UNSUPPORTED_FIELD',
            'Request contains an unsupported field'
        );
    }

    if (body.userId !== undefined) {
        if (
            typeof body.userId !== 'string' ||
            !body.userId.trim() ||
            body.userId !== body.userId.trim() ||
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
            !body.grade.trim() ||
            body.grade !== body.grade.trim() ||
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
