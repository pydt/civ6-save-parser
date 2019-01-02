module.exports = {
    "parserOptions": {
        "ecmaVersion": 6
    },
    "extends": "google",
    "rules": {
        "linebreak-style": "off",
        "require-jsdoc": "off",
        "max-len": ["error", {
            "code": 120
        }],
        "eqeqeq": ["error", "always"]
    }
};