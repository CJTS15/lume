// SPDX-License-Identifier: GPL-3.0-or-later
//
// A small recursive-descent parser for arithmetic. It never uses eval() or
// Function(): input is tokenized and only known operators, functions and
// constants are accepted. No gi:// imports, so tests run under plain gjs.
//
// Grammar:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary | power)*   the bare power is
//                                            implicit multiplication: 2pi
//   unary   := ('+' | '-') unary | power
//   power   := primary ('^' unary)?          right-associative, -2^2 = -4
//   primary := number | constant | function '(' args ')' | '(' expr ')'
//   args    := expr (',' expr)*

const MAX_LENGTH = 200;
const MAX_DEPTH = 50;
const MAX_FACTORIAL = 170; // 171! is not a finite double

const toRadians = x => x * Math.PI / 180;
const toDegrees = x => x * 180 / Math.PI;

function factorial(n) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_FACTORIAL)
        return NaN;
    let result = 1;
    for (let i = 2; i <= n; i++)
        result *= i;
    return result;
}

// Round half to even, as C's rint() does in the default rounding mode.
function rint(x) {
    const floor = Math.floor(x);
    const diff = x - floor;
    if (diff !== 0.5)
        return Math.round(x);
    return floor % 2 === 0 ? floor : floor + 1;
}

// [arity, function]; arity -1 takes one or more arguments.
const FUNCTIONS = {
    sqrt: [1, Math.sqrt],
    cbrt: [1, Math.cbrt],
    abs: [1, Math.abs],
    exp: [1, Math.exp],
    ln: [1, Math.log],
    log: [1, Math.log10],
    log10: [1, Math.log10],
    log2: [1, Math.log2],
    // Half away from zero, like C's round(); Math.round rounds -2.5 to -2.
    round: [1, x => Math.sign(x) * Math.round(Math.abs(x))],
    rint: [1, rint],
    floor: [1, Math.floor],
    ceil: [1, Math.ceil],
    fact: [1, factorial],
    rad: [1, toRadians],
    deg: [1, toDegrees],
    sin: [1, Math.sin],
    cos: [1, Math.cos],
    tan: [1, Math.tan],
    asin: [1, Math.asin],
    acos: [1, Math.acos],
    atan: [1, Math.atan],
    sinh: [1, Math.sinh],
    cosh: [1, Math.cosh],
    tanh: [1, Math.tanh],
    asinh: [1, Math.asinh],
    acosh: [1, Math.acosh],
    atanh: [1, Math.atanh],
    pow: [2, Math.pow],
    // JS % is C's fmod: the result takes the sign of the dividend.
    fmod: [2, (a, b) => a % b],
    hypot: [-1, Math.hypot],
    min: [-1, Math.min],
    max: [-1, Math.max],
};

// Degree variants: sind(30) = 0.5, asind(0.5) = 30. Values within rounding
// noise of zero (sind(180)) become exactly zero.
const snap = x => (Math.abs(x) < 1e-15 ? 0 : x);
for (const name of ['sin', 'cos', 'tan'])
    FUNCTIONS[`${name}d`] = [1, x => snap(Math[name](toRadians(x)))];
for (const name of ['asin', 'acos', 'atan'])
    FUNCTIONS[`${name}d`] = [1, x => toDegrees(Math[name](x))];

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

        const name = /^(π|[a-z][a-z0-9]*)/i.exec(text.slice(i));
        if (name) {
            const id = name[0].toLowerCase();
            // hasOwn: "constructor" must not find Object.prototype's.
            if (Object.hasOwn(FUNCTIONS, id))
                tokens.push({type: 'function', value: id});
            else if (Object.hasOwn(CONSTANTS, id))
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
        if ('+-*/%^(),'.includes(op)) {
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
        for (;;) {
            if (this._isOp('*') || this._isOp('/') || this._isOp('%')) {
                const op = this._tokens[this._pos++].value;
                const rhs = this._unary();
                if (op === '*')
                    value *= rhs;
                else if (op === '/')
                    value /= rhs;
                else
                    value %= rhs;
            } else if (this._implicitMultiplication()) {
                value *= this._power();
            } else {
                return value;
            }
        }
    }

    /**
     * Whether the next token multiplies the value before it without an
     * operator: 2pi, 2(3+4), (2)(3), 2sqrt(4), pi 2. Two plain numbers
     * ("2 3") do not, so a stray space is not read as multiplication.
     */
    _implicitMultiplication() {
        const previous = this._tokens[this._pos - 1];
        const next = this._peek();
        if (!previous || !next)
            return false;

        const closesValue = previous.type === 'number' ||
            (previous.type === 'op' && previous.value === ')');
        if (!closesValue)
            return false;
        if (next.type === 'function' || (next.type === 'op' && next.value === '('))
            return true;
        return next.type === 'number' &&
            (next.constant || previous.constant || previous.value === ')');
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
            const [arity, fn] = FUNCTIONS[token.value];
            this._enter();
            this._expect('(');
            const args = [this._expr()];
            while (this._isOp(',')) {
                this._pos++;
                args.push(this._expr());
            }
            this._expect(')');
            this._depth--;
            if (arity !== -1 && args.length !== arity)
                throw new Error(`${token.value} takes ${arity} argument(s)`);
            return fn(...args);
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
    if (!tokens)
        return null;
    // A lone number or constant, even in parentheses, is not a calculation.
    const values = tokens.filter(t => !(t.type === 'op' && (t.value === '(' || t.value === ')')));
    if (values.length < 2 && !values.some(t => t.type === 'function'))
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
