module.exports = {
  "env": {
    "browser": true,
    "es2021": true,
  },
  "extends": [
    "plugin:react/recommended",
    "google",
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaFeatures": {
      "jsx": true,
    },
    "ecmaVersion": 12,
    "sourceType": "module",
  },
  "plugins": [
    "react",
    "@typescript-eslint",
    "eslint-plugin-jsdoc",
  ],
  "rules": {
    "quotes": ["error", "double"],
    "semi": ["error", "always"],
    "no-multi-spaces": "off",
    "operator-linebreak": "off",
    "object-curly-spacing": ["error", "always"],
    "no-unused-vars": "warn",
    "curly": "off",
    "arrow-parens": "off",
    "spaced-comment": "off",
    "max-len": ["error", 100],

    "react/prop-types": "off",

    "@typescript-eslint/explicit-member-accessibility": ["error", {
      accessibility: "explicit",
    }],
  },
};
