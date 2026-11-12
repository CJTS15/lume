// SPDX-License-Identifier: GPL-3.0-or-later
//
// A small recursive-descent parser for arithmetic. It never uses eval() or
// Function(): input is tokenized and only known operators, functions and
// constants are accepted. No gi:// imports, so tests run under plain gjs.
//
// Grammar:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary)*
//   unary   := ('+' | '-') unary | power
//   power   := primary ('^' unary)?          right-associative, -2^2 = -4
//   primary := number | constant | function '(' expr ')' | '(' expr ')'

const MAX_LENGTH = 200;
const MAX_DEPTH = 50;

const FUNCTIONS = {
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    exp: Math.exp,
    ln: Math.log,
    log: Math.log10,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
};

const CONSTANTS = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
};

// Typographic variants people paste or type.
const OPERATOR_ALIASES = {
    '×': '*',
    '·': '*',
    '÷': '/',
    '−': '-',
};

function tokenize(text) {
    const tokens = [];
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
        if (number) {
            tokens.push({type: 'number', value: parseFloat(number[0])});
            i += number[0].length;
            continue;
        }

        const name = /^[a-zπ]+/i.exec(text.slice(i));
        if (name) {
            const id = name[0].toLowerCase();
            if (id in FUNCTIONS)
                tokens.push({type: 'function', value: id});
            else if (id in CONSTANTS)
                tokens.push({type: 'number', value: CONSTANTS[id], constant: true});
            else
                return null;
            i += name[0].length;
            continue;
        }

        if (text.startsWith('**', i)) {
            tokens.push({type: 'op', value: '^'});
            i += 2;
            continue;
        }

        const op = OPERATOR_ALIASES[ch] ?? ch;
        if ('+-*/%^()'.includes(op)) {
            tokens.push({type: 'op', value: op});
            i++;
            continue;
        }

        return null;
    }
    return tokens;
}

class Parser {
    constructor(tokens) {
        this._tokens = tokens;
        this._pos = 0;
        this._depth = 0;
    }

    parse() {
        const value = this._expr();
        if (this._pos !== this._tokens.length)
            throw new Error('Unexpected token');
        return value;
    }

    _peek() {
        return this._tokens[this._pos];
    }

    _isOp(value) {
        const token = this._peek();
        return token?.type === 'op' && token.value === value;
    }

    _expect(value) {
        if (!this._isOp(value))
            throw new Error(`Expected "${value}"`);
        this._pos++;
    }

    _enter() {
        if (++this._depth > MAX_DEPTH)
            throw new Error('Expression too deep');
    }

    _expr() {
        let value = this._term();
        while (this._isOp('+') || this._isOp('-')) {
            const op = this._tokens[this._pos++].value;
            const rhs = this._term();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    }

    _term() {
        let value = this._unary();
        while (this._isOp('*') || this._isOp('/') || this._isOp('%')) {
            const op = this._tokens[this._pos++].value;
            const rhs = this._unary();
            if (op === '*')
                value *= rhs;
            else if (op === '/')
                value /= rhs;
            else
                value %= rhs;
        }
        return value;
    }

    _unary() {
        this._enter();
        let value;
        if (this._isOp('-')) {
            this._pos++;
            value = -this._unary();
        } else if (this._isOp('+')) {
            this._pos++;
            value = this._unary();
        } else {
            value = this._power();
        }
        this._depth--;
        return value;
    }

    _power() {
        const base = this._primary();
        if (!this._isOp('^'))
            return base;
        this._pos++;
        return base ** this._unary();
    }

    _primary() {
        const token = this._tokens[this._pos++];
        if (!token)
            throw new Error('Unexpected end');

        if (token.type === 'number')
            return token.value;

        if (token.type === 'function') {
            this._expect('(');
            const arg = this._expr();
            this._expect(')');
            return FUNCTIONS[token.value](arg);
        }

        if (token.type === 'op' && token.value === '(') {
            this._enter();
            const value = this._expr();
            this._expect(')');
            this._depth--;
            return value;
        }

        throw new Error('Unexpected token');
    }
}

/**
 * Evaluate `text` if it is an arithmetic expression.
 *
 * Returns null for anything that is not a complete expression, for a lone
 * number or constant (so typing "42" or "e" shows no calculator row), and
 * for results that are not finite numbers.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function evaluate(text) {
    // Allow a trailing "=", as in "2+2=".
    text = text.trim().replace(/=$/, '').trim();
    if (!text || text.length > MAX_LENGTH)
        return null;

    const tokens = tokenize(text);
    if (!tokens || tokens.length < 2)
        return null;
    if (!tokens.some(t => t.type === 'function' || (t.type === 'op' && t.value !== '(' && t.value !== ')')))
        return null;

    let value;
    try {
        value = new Parser(tokens).parse();
    } catch {
        return null;
    }
    return Number.isFinite(value) ? value : null;
}

/**
 * Format a result for display and copying: 12 significant digits, which
 * hides binary rounding noise (0.1 + 0.2 shows as 0.3).
 *
 * @param {number} value
 * @returns {string}
 */
export function formatResult(value) {
    const rounded = parseFloat(value.toPrecision(12));
    // Avoid "-0".
    return String(rounded === 0 ? 0 : rounded);
}
