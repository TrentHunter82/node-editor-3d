import type { NodeType } from '../types';

export interface PortHelp {
  name: string;
  type: string;
  description: string;
}

export interface NodeHelpEntry {
  nodeType: NodeType;
  category: string;
  summary: string;
  description: string;
  inputs: PortHelp[];
  outputs: PortHelp[];
  tips?: string[];
}

const NODE_HELP: Record<string, NodeHelpEntry> = {
  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------
  source: {
    nodeType: 'source',
    category: 'Core',
    summary: 'Produces a constant numeric value as a starting point for pipelines.',
    description:
      'The source node has no inputs. It outputs a configurable numeric value and its type label. Use it as the origin of a data flow chain.',
    inputs: [],
    outputs: [
      { name: 'value', type: 'number', description: 'The numeric value produced by this source.' },
      { name: 'label', type: 'string', description: 'A string label describing the value type.' },
    ],
    tips: [
      'Double-click the node to edit the value inline.',
      'Chain multiple source nodes into a math node for basic arithmetic.',
    ],
  },

  transform: {
    nodeType: 'transform',
    category: 'Core',
    summary: 'Applies a linear transformation (multiplier and offset) to a numeric value.',
    description:
      'Computes result = in * factor + offset. The debug output shows the computation as a readable string. Useful for unit conversion or scaling.',
    inputs: [
      { name: 'in', type: 'number', description: 'The input value to transform.' },
      { name: 'factor', type: 'number', description: 'Multiplication factor applied to the input.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The transformed numeric result.' },
      { name: 'debug', type: 'string', description: 'A human-readable string showing the computation.' },
    ],
    tips: [
      'Set factor to 1 and use offset alone for simple addition.',
    ],
  },

  filter: {
    nodeType: 'filter',
    category: 'Core',
    summary: 'Passes through a value only if it meets a configurable condition.',
    description:
      'Compares the input value against a threshold using the selected mode (greater, less, equal). If the condition is met the value passes through; otherwise it outputs null.',
    inputs: [
      { name: 'in', type: 'any', description: 'The value to test against the threshold.' },
    ],
    outputs: [
      { name: 'out', type: 'any', description: 'The original value if condition is met, otherwise null.' },
    ],
    tips: [
      'Supports greater, less, and equal comparison modes.',
      'Combine with a compare node for more complex conditional logic.',
    ],
  },

  output: {
    nodeType: 'output',
    category: 'Core',
    summary: 'Terminal node that receives data and marks the end of a pipeline.',
    description:
      'Accepts any data as input along with an optional label and acts as a sink. Output nodes are useful as explicit endpoints for data flow and can be observed in the debug panel.',
    inputs: [
      { name: 'data', type: 'any', description: 'The data to consume at the end of the pipeline.' },
      { name: 'label', type: 'string', description: 'An optional label for this output.' },
    ],
    outputs: [],
  },

  // ---------------------------------------------------------------------------
  // Math
  // ---------------------------------------------------------------------------
  math: {
    nodeType: 'math',
    category: 'Math',
    summary: 'Performs a basic arithmetic operation on two numbers.',
    description:
      'Takes two numeric inputs and applies the selected operation (add, subtract, multiply, divide, modulo, or power). Division by zero returns 0.',
    inputs: [
      { name: 'a', type: 'number', description: 'The first operand.' },
      { name: 'b', type: 'number', description: 'The second operand.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The result of the arithmetic operation.' },
    ],
    tips: [
      'Use the operation dropdown to switch between add, sub, mul, div, mod, and pow.',
      'For unary math (sin, abs, etc.) use the dedicated nodes instead.',
    ],
  },

  clamp: {
    nodeType: 'clamp',
    category: 'Math',
    summary: 'Restricts a number to lie within a specified minimum and maximum range.',
    description:
      'If the input value is below min it outputs min; if above max it outputs max; otherwise it passes the value through unchanged.',
    inputs: [
      { name: 'value', type: 'number', description: 'The number to clamp.' },
      { name: 'min', type: 'number', description: 'The lower bound of the clamp range.' },
      { name: 'max', type: 'number', description: 'The upper bound of the clamp range.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The clamped value within [min, max].' },
    ],
    tips: [
      'Set min=0 and max=1 to normalize a value to the 0-1 range.',
    ],
  },

  remap: {
    nodeType: 'remap',
    category: 'Math',
    summary: 'Linearly maps a value from one numeric range to another.',
    description:
      'Given an input value in the range [inMin, inMax], produces the proportionally equivalent value in [outMin, outMax]. Values outside the input range are extrapolated.',
    inputs: [
      { name: 'value', type: 'number', description: 'The value to remap.' },
      { name: 'inMin', type: 'number', description: 'The minimum of the input range.' },
      { name: 'inMax', type: 'number', description: 'The maximum of the input range.' },
      { name: 'outMin', type: 'number', description: 'The minimum of the output range.' },
      { name: 'outMax', type: 'number', description: 'The maximum of the output range.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The remapped value in the output range.' },
    ],
    tips: [
      'Combine with clamp to prevent extrapolation beyond the output range.',
      'Useful for converting sensor data or normalizing ranges.',
    ],
  },

  sin: {
    nodeType: 'sin',
    category: 'Math',
    summary: 'Computes the sine of an angle in radians.',
    description:
      'Returns Math.sin(value). The input is expected in radians. Outputs a number between -1 and 1.',
    inputs: [
      { name: 'value', type: 'number', description: 'The angle in radians.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The sine of the input angle.' },
    ],
  },

  cos: {
    nodeType: 'cos',
    category: 'Math',
    summary: 'Computes the cosine of an angle in radians.',
    description:
      'Returns Math.cos(value). The input is expected in radians. Outputs a number between -1 and 1.',
    inputs: [
      { name: 'value', type: 'number', description: 'The angle in radians.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The cosine of the input angle.' },
    ],
  },

  tan: {
    nodeType: 'tan',
    category: 'Math',
    summary: 'Computes the tangent of an angle in radians.',
    description:
      'Returns Math.tan(value). The input is expected in radians. Output can be any real number and approaches infinity near odd multiples of pi/2.',
    inputs: [
      { name: 'value', type: 'number', description: 'The angle in radians.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The tangent of the input angle.' },
    ],
  },

  abs: {
    nodeType: 'abs',
    category: 'Math',
    summary: 'Returns the absolute (non-negative) value of a number.',
    description:
      'Computes Math.abs(value). Negative inputs become positive; positive inputs and zero are unchanged.',
    inputs: [
      { name: 'value', type: 'number', description: 'The input number.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The absolute value.' },
    ],
  },

  floor: {
    nodeType: 'floor',
    category: 'Math',
    summary: 'Rounds a number down to the nearest integer.',
    description:
      'Computes Math.floor(value). Always rounds toward negative infinity: floor(2.9) = 2, floor(-2.1) = -3.',
    inputs: [
      { name: 'value', type: 'number', description: 'The number to round down.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The largest integer less than or equal to the input.' },
    ],
  },

  ceil: {
    nodeType: 'ceil',
    category: 'Math',
    summary: 'Rounds a number up to the nearest integer.',
    description:
      'Computes Math.ceil(value). Always rounds toward positive infinity: ceil(2.1) = 3, ceil(-2.9) = -2.',
    inputs: [
      { name: 'value', type: 'number', description: 'The number to round up.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The smallest integer greater than or equal to the input.' },
    ],
  },

  round: {
    nodeType: 'round',
    category: 'Math',
    summary: 'Rounds a number to the nearest integer using standard rounding.',
    description:
      'Computes Math.round(value). Values at .5 round toward positive infinity: round(2.5) = 3, round(-2.5) = -2.',
    inputs: [
      { name: 'value', type: 'number', description: 'The number to round.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The nearest integer.' },
    ],
  },

  log: {
    nodeType: 'log',
    category: 'Math',
    summary: 'Computes the natural logarithm (base e) of a number.',
    description:
      'Returns Math.log(value). Non-positive inputs return 0. Disconnected input defaults to 1 so the output is 0.',
    inputs: [
      { name: 'value', type: 'number', description: 'The positive number to take the logarithm of.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The natural logarithm of the input, or 0 for non-positive values.' },
    ],
    tips: [
      'Disconnected input defaults to 1 (not 0) because log(1) = 0 is a valid identity.',
      'Non-positive inputs return 0 instead of negative infinity or NaN.',
    ],
  },

  sqrt: {
    nodeType: 'sqrt',
    category: 'Math',
    summary: 'Computes the square root of a non-negative number.',
    description:
      'Returns Math.sqrt(value). Negative inputs return 0. Use abs first if your input may be negative.',
    inputs: [
      { name: 'value', type: 'number', description: 'The non-negative number.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The square root of the input, or 0 for negative values.' },
    ],
  },

  lerp: {
    nodeType: 'lerp',
    category: 'Math',
    summary: 'Linearly interpolates between two values by a blend factor.',
    description:
      'Computes a + (b - a) * t. When t=0 the result equals a; when t=1 the result equals b. Values of t outside 0-1 extrapolate beyond the range.',
    inputs: [
      { name: 'a', type: 'number', description: 'The start value (returned when t=0).' },
      { name: 'b', type: 'number', description: 'The end value (returned when t=1).' },
      { name: 't', type: 'number', description: 'The interpolation factor, typically 0 to 1.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The interpolated value.' },
    ],
    tips: [
      'Clamp t to 0-1 with a clamp node to prevent extrapolation.',
    ],
  },

  mean: {
    nodeType: 'mean',
    category: 'Math',
    summary: 'Computes the arithmetic mean (average) of an array of numbers.',
    description:
      'Sums all values in the input array and divides by the count. Returns 0 for an empty array.',
    inputs: [
      { name: 'array', type: 'any', description: 'An array of numbers to average.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The arithmetic mean.' },
    ],
  },

  median: {
    nodeType: 'median',
    category: 'Math',
    summary: 'Computes the median (middle value) of an array of numbers.',
    description:
      'Sorts the input array and returns the middle element. For arrays with an even count the two central values are averaged.',
    inputs: [
      { name: 'array', type: 'any', description: 'An array of numbers.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The median value.' },
    ],
  },

  stddev: {
    nodeType: 'stddev',
    category: 'Math',
    summary: 'Computes the population standard deviation of an array of numbers.',
    description:
      'Measures how spread out the values are from the mean. Returns 0 for arrays with fewer than two elements.',
    inputs: [
      { name: 'array', type: 'any', description: 'An array of numbers.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The population standard deviation.' },
    ],
  },

  'min-array': {
    nodeType: 'min-array',
    category: 'Math',
    summary: 'Returns the smallest value from an array of numbers.',
    description:
      'Scans through every element in the input array and outputs the minimum. Returns 0 for an empty array.',
    inputs: [
      { name: 'array', type: 'any', description: 'An array of numbers to search.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The smallest number in the array.' },
    ],
  },

  'max-array': {
    nodeType: 'max-array',
    category: 'Math',
    summary: 'Returns the largest value from an array of numbers.',
    description:
      'Scans through every element in the input array and outputs the maximum. Returns 0 for an empty array.',
    inputs: [
      { name: 'array', type: 'any', description: 'An array of numbers to search.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The largest number in the array.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // String
  // ---------------------------------------------------------------------------
  concat: {
    nodeType: 'concat',
    category: 'String',
    summary: 'Concatenates two strings together into one.',
    description:
      'Joins input a and input b end-to-end. Non-string values are coerced to strings before joining.',
    inputs: [
      { name: 'a', type: 'string', description: 'The first string.' },
      { name: 'b', type: 'string', description: 'The second string appended after a.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The concatenated string.' },
    ],
  },

  template: {
    nodeType: 'template',
    category: 'String',
    summary: 'Builds a string by substituting a value into a template pattern.',
    description:
      'The template string uses a {value} placeholder which is replaced by the value input. Useful for formatting messages or labels with a single dynamic value.',
    inputs: [
      { name: 'template', type: 'string', description: 'Template string containing {value} placeholder.' },
      { name: 'value', type: 'any', description: 'Value to substitute into the {value} placeholder.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The formatted string after substitution.' },
    ],
    tips: [
      'Use {value} as the placeholder in your template string.',
      'For multiple placeholders, use the string-template node instead.',
    ],
  },

  'string-length': {
    nodeType: 'string-length',
    category: 'String',
    summary: 'Returns the number of characters in a string.',
    description:
      'Outputs the length of the input string. An empty string returns 0.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to measure.' },
    ],
    outputs: [
      { name: 'length', type: 'number', description: 'The character count of the string.' },
    ],
  },

  'string-trim': {
    nodeType: 'string-trim',
    category: 'String',
    summary: 'Removes leading and trailing whitespace from a string.',
    description:
      'Strips spaces, tabs, newlines, and other whitespace characters from both ends of the input string.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to trim.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The trimmed string.' },
    ],
  },

  'string-split': {
    nodeType: 'string-split',
    category: 'String',
    summary: 'Splits a string at a delimiter, returning the first part, the rest, and the count.',
    description:
      'Splits the input string by the delimiter. Returns the first part, the remaining string after the first delimiter, and the total number of parts.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to split.' },
      { name: 'delimiter', type: 'string', description: 'The delimiter to split on.' },
    ],
    outputs: [
      { name: 'first', type: 'string', description: 'The first part before the delimiter.' },
      { name: 'rest', type: 'string', description: 'The remaining parts after the first delimiter.' },
      { name: 'count', type: 'number', description: 'The total number of parts.' },
    ],
    tips: [
      'Set the delimiter to a comma for CSV-style splitting.',
    ],
  },

  'string-case': {
    nodeType: 'string-case',
    category: 'String',
    summary: 'Converts a string to both upper case and lower case simultaneously.',
    description:
      'Transforms the input string into two outputs: an uppercase version and a lowercase version.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to convert.' },
    ],
    outputs: [
      { name: 'upper', type: 'string', description: 'The string converted to UPPERCASE.' },
      { name: 'lower', type: 'string', description: 'The string converted to lowercase.' },
    ],
  },

  'parse-number': {
    nodeType: 'parse-number',
    category: 'String',
    summary: 'Parses a string into a numeric value with a validity flag.',
    description:
      'Attempts to convert the input string to a number using Number() coercion (stricter than parseFloat — partial strings like \'3.14abc\' return NaN). Returns 0 if the string cannot be parsed, along with a boolean indicating whether parsing succeeded.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to parse as a number.' },
    ],
    outputs: [
      { name: 'value', type: 'number', description: 'The parsed numeric value, or 0 on failure.' },
      { name: 'valid', type: 'boolean', description: 'True if the string was a valid number.' },
    ],
  },

  'string-concat': {
    nodeType: 'string-concat',
    category: 'String',
    summary: 'Concatenates two strings together with an optional separator.',
    description:
      'Joins input a and input b. Similar to concat but available as a dedicated string operation for clarity in complex graphs.',
    inputs: [
      { name: 'a', type: 'string', description: 'The first string.' },
      { name: 'b', type: 'string', description: 'The second string appended after a.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The concatenated result.' },
    ],
  },

  'string-replace': {
    nodeType: 'string-replace',
    category: 'String',
    summary: 'Replaces occurrences of a search pattern within a string.',
    description:
      'Searches for the given pattern in the input string and replaces matches with the replacement text. Supports an optional regex flag for pattern matching.',
    inputs: [
      { name: 'str', type: 'string', description: 'The original string to search within.' },
      { name: 'search', type: 'string', description: 'The substring or regex pattern to find.' },
      { name: 'replace', type: 'string', description: 'The replacement text.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The string with replacements applied.' },
    ],
    tips: [
      'Enable the regex flag to use regular expression patterns for search.',
    ],
  },

  'string-includes': {
    nodeType: 'string-includes',
    category: 'String',
    summary: 'Checks whether a string contains a given substring.',
    description:
      'Returns true if the search string is found anywhere within the input string, and false otherwise. The check is case-sensitive.',
    inputs: [
      { name: 'str', type: 'string', description: 'The string to search within.' },
      { name: 'search', type: 'string', description: 'The substring to look for.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'True if the substring is found, false otherwise.' },
    ],
  },

  'string-template': {
    nodeType: 'string-template',
    category: 'String',
    summary: 'Formats a string by substituting input values into a template with ${in0} placeholders.',
    description:
      'Takes a template string input and up to four value inputs. Uses ${in0} through ${in3} placeholders that are replaced by the corresponding input values.',
    inputs: [
      { name: 'template', type: 'string', description: 'Template string with ${in0}, ${in1}, ${in2}, ${in3} placeholders.' },
      { name: 'in0', type: 'any', description: 'Value substituted for ${in0}.' },
      { name: 'in1', type: 'any', description: 'Value substituted for ${in1}.' },
      { name: 'in2', type: 'any', description: 'Value substituted for ${in2}.' },
      { name: 'in3', type: 'any', description: 'Value substituted for ${in3}.' },
    ],
    outputs: [
      { name: 'result', type: 'string', description: 'The formatted string after placeholder substitution.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Logic
  // ---------------------------------------------------------------------------
  compare: {
    nodeType: 'compare',
    category: 'Logic',
    summary: 'Compares two values using a relational operator and outputs a boolean.',
    description:
      'Evaluates a comparison (==, !=, <, >, <=, >=) between inputs a and b. Returns true or false. Non-numeric comparisons use JavaScript coercion rules.',
    inputs: [
      { name: 'a', type: 'any', description: 'The left-hand side of the comparison.' },
      { name: 'b', type: 'any', description: 'The right-hand side of the comparison.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'The boolean result of the comparison.' },
    ],
    tips: [
      'Use == and != for loose equality; values are coerced before comparison.',
    ],
  },

  switch: {
    nodeType: 'switch',
    category: 'Logic',
    summary: 'Selects an output from multiple cases based on a matching input value.',
    description:
      'Compares the value input against case0 through case3. When a match is found the corresponding value is output. If no case matches the default value is used.',
    inputs: [
      { name: 'value', type: 'any', description: 'The value to match against cases.' },
      { name: 'case0', type: 'any', description: 'First case value to match.' },
      { name: 'case1', type: 'any', description: 'Second case value to match.' },
      { name: 'case2', type: 'any', description: 'Third case value to match.' },
      { name: 'case3', type: 'any', description: 'Fourth case value to match.' },
      { name: 'default', type: 'any', description: 'Fallback value when no case matches.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The matched case value or default.' },
    ],
    tips: [
      'Cases are checked in order; the first match wins.',
    ],
  },

  and: {
    nodeType: 'and',
    category: 'Logic',
    summary: 'Returns true only when both boolean inputs are true.',
    description:
      'Performs a logical AND operation on two boolean inputs. The output is true if and only if both a and b are true.',
    inputs: [
      { name: 'a', type: 'boolean', description: 'The first boolean operand.' },
      { name: 'b', type: 'boolean', description: 'The second boolean operand.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'True if both inputs are true.' },
    ],
  },

  or: {
    nodeType: 'or',
    category: 'Logic',
    summary: 'Returns true when at least one of the boolean inputs is true.',
    description:
      'Performs a logical OR operation. The output is true if either a or b (or both) are true.',
    inputs: [
      { name: 'a', type: 'boolean', description: 'The first boolean operand.' },
      { name: 'b', type: 'boolean', description: 'The second boolean operand.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'True if at least one input is true.' },
    ],
  },

  not: {
    nodeType: 'not',
    category: 'Logic',
    summary: 'Inverts a boolean value: true becomes false and vice versa.',
    description:
      'Performs a logical NOT operation. Outputs the opposite of the input boolean.',
    inputs: [
      { name: 'value', type: 'boolean', description: 'The boolean value to invert.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'The inverted boolean.' },
    ],
  },

  xor: {
    nodeType: 'xor',
    category: 'Logic',
    summary: 'Returns true when exactly one of the two boolean inputs is true.',
    description:
      'Performs a logical exclusive-OR. The output is true if a and b differ, and false if they are the same.',
    inputs: [
      { name: 'a', type: 'boolean', description: 'The first boolean operand.' },
      { name: 'b', type: 'boolean', description: 'The second boolean operand.' },
    ],
    outputs: [
      { name: 'result', type: 'boolean', description: 'True if exactly one input is true.' },
    ],
  },

  'if-gate': {
    nodeType: 'if-gate',
    category: 'Logic',
    summary: 'Outputs one of two values based on a boolean condition.',
    description:
      'When the condition is true the trueVal input is forwarded to the output; when false the falseVal input is used instead. Acts as a ternary operator.',
    inputs: [
      { name: 'condition', type: 'boolean', description: 'The boolean condition to evaluate.' },
      { name: 'true', type: 'any', description: 'Value output when condition is true.' },
      { name: 'false', type: 'any', description: 'Value output when condition is false.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The selected value based on the condition.' },
    ],
    tips: [
      'Equivalent to the ternary expression: condition ? trueVal : falseVal.',
    ],
  },

  select: {
    nodeType: 'select',
    category: 'Logic',
    summary: 'Selects one of up to four values based on a numeric index.',
    description:
      'Uses the index input (0-3) to choose which of the value inputs to forward to the output. Out-of-range indices are clamped to the valid range (0-3).',
    inputs: [
      { name: 'index', type: 'number', description: 'The zero-based index selecting which value to output.' },
      { name: 'value0', type: 'any', description: 'Value output when index is 0.' },
      { name: 'value1', type: 'any', description: 'Value output when index is 1.' },
      { name: 'value2', type: 'any', description: 'Value output when index is 2.' },
      { name: 'value3', type: 'any', description: 'Value output when index is 3.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The value at the selected index.' },
    ],
    tips: [
      'Combine with floor or round to ensure the index is an integer.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Vector
  // ---------------------------------------------------------------------------
  'compose-vec3': {
    nodeType: 'compose-vec3',
    category: 'Vector',
    summary: 'Combines three numbers into a single 3D vector.',
    description:
      'Takes x, y, and z numeric inputs and packs them into a vector3 value. Use this to construct positions, directions, or colors from individual components.',
    inputs: [
      { name: 'x', type: 'number', description: 'The X component of the vector.' },
      { name: 'y', type: 'number', description: 'The Y component of the vector.' },
      { name: 'z', type: 'number', description: 'The Z component of the vector.' },
    ],
    outputs: [
      { name: 'vector', type: 'vector3', description: 'The composed 3D vector [x, y, z].' },
    ],
  },

  'decompose-vec3': {
    nodeType: 'decompose-vec3',
    category: 'Vector',
    summary: 'Splits a 3D vector into its individual x, y, and z components.',
    description:
      'Takes a vector3 input and outputs each component as a separate number. Useful for manipulating individual axes of a position or direction.',
    inputs: [
      { name: 'vector', type: 'vector3', description: 'The 3D vector to decompose.' },
    ],
    outputs: [
      { name: 'x', type: 'number', description: 'The X component.' },
      { name: 'y', type: 'number', description: 'The Y component.' },
      { name: 'z', type: 'number', description: 'The Z component.' },
    ],
  },

  'dot-product': {
    nodeType: 'dot-product',
    category: 'Vector',
    summary: 'Computes the dot product of two 3D vectors.',
    description:
      'Calculates a.x*b.x + a.y*b.y + a.z*b.z. The result is a scalar indicating how aligned the two vectors are. Perpendicular vectors yield 0.',
    inputs: [
      { name: 'a', type: 'any', description: 'The first 3D vector.' },
      { name: 'b', type: 'any', description: 'The second 3D vector.' },
    ],
    outputs: [
      { name: 'dot', type: 'number', description: 'The scalar dot product.' },
    ],
    tips: [
      'A positive dot product means the vectors point in a similar direction.',
    ],
  },

  'cross-product': {
    nodeType: 'cross-product',
    category: 'Vector',
    summary: 'Computes the cross product of two 3D vectors.',
    description:
      'Produces a new vector that is perpendicular to both input vectors. The magnitude equals the area of the parallelogram formed by the two inputs.',
    inputs: [
      { name: 'a', type: 'any', description: 'The first 3D vector.' },
      { name: 'b', type: 'any', description: 'The second 3D vector.' },
    ],
    outputs: [
      { name: 'cross', type: 'any', description: 'The 3D cross product vector.' },
    ],
    tips: [
      'Order matters: cross(a, b) = -cross(b, a).',
    ],
  },

  'normalize-vec3': {
    nodeType: 'normalize-vec3',
    category: 'Vector',
    summary: 'Scales a 3D vector to unit length (magnitude of 1).',
    description:
      'Divides each component of the input vector by its length. The result points in the same direction but has a magnitude of 1. A zero-length vector returns [0,0,0].',
    inputs: [
      { name: 'vector', type: 'any', description: 'The 3D vector to normalize.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The unit-length direction vector.' },
    ],
  },

  'vec3-length': {
    nodeType: 'vec3-length',
    category: 'Vector',
    summary: 'Computes the magnitude (length) of a 3D vector.',
    description:
      'Returns sqrt(x*x + y*y + z*z) for the input vector. Useful for measuring distances or checking if a vector is zero.',
    inputs: [
      { name: 'vector', type: 'any', description: 'The 3D vector to measure.' },
    ],
    outputs: [
      { name: 'result', type: 'number', description: 'The scalar length of the vector.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------
  note: {
    nodeType: 'note',
    category: 'Utility',
    summary: 'A text annotation node for documenting your graph visually.',
    description:
      'Has no inputs or outputs and does not participate in execution. Use it to leave comments, explanations, or section labels in your node graph.',
    inputs: [],
    outputs: [],
    tips: [
      'Double-click to edit the note text.',
      'Use notes to label sections of complex graphs for collaborators.',
    ],
  },

  reroute: {
    nodeType: 'reroute',
    category: 'Utility',
    summary: 'A pass-through node used to organize and route connections neatly.',
    description:
      'Passes the input value directly to the output without modification. Insert reroute nodes to create cleaner connection paths and reduce visual clutter.',
    inputs: [
      { name: 'in', type: 'any', description: 'The value to pass through.' },
    ],
    outputs: [
      { name: 'out', type: 'any', description: 'The same value, unchanged.' },
    ],
    tips: [
      'Place reroute nodes at corners to keep long connections tidy.',
    ],
  },

  random: {
    nodeType: 'random',
    category: 'Utility',
    summary: 'Generates a random number within a configurable range.',
    description:
      'Outputs a random value between min and max (inclusive). If a seed is provided the sequence is deterministic and repeatable; without a seed each execution produces a new value.',
    inputs: [],
    outputs: [
      { name: 'value', type: 'number', description: 'A random number in [min, max].' },
    ],
    tips: [
      'Set a seed for reproducible results across executions.',
      'Without a seed, this node bypasses execution caching (non-deterministic).',
    ],
  },

  display: {
    nodeType: 'display',
    category: 'Utility',
    summary: 'Shows the current value of a connection inline as a sink node.',
    description:
      'Renders the input value visually on the node. This is a sink node with no outputs, useful for debugging intermediate results.',
    inputs: [
      { name: 'value', type: 'any', description: 'The value to display.' },
    ],
    outputs: [],
    tips: [
      'Insert display nodes mid-pipeline to inspect intermediate values.',
      'This is a sink node with no outputs; it does not pass data through.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Color
  // ---------------------------------------------------------------------------
  'color-picker': {
    nodeType: 'color-picker',
    category: 'Color',
    summary: 'Provides a user-selected color as hex and individual RGB components.',
    description:
      'Opens an interactive color picker UI. Outputs the selected color as a hex string and as separate red, green, and blue numeric components (0-255).',
    inputs: [],
    outputs: [
      { name: 'hex', type: 'color', description: 'The selected color as a hex string (e.g. #ff0000).' },
      { name: 'r', type: 'number', description: 'The red component (0-255).' },
      { name: 'g', type: 'number', description: 'The green component (0-255).' },
      { name: 'b', type: 'number', description: 'The blue component (0-255).' },
    ],
    tips: [
      'Click the color swatch on the node to open the color picker.',
    ],
  },

  'color-mix': {
    nodeType: 'color-mix',
    category: 'Color',
    summary: 'Blends two colors together by a given interpolation factor.',
    description:
      'Linearly interpolates between color1 and color2 using factor t. When t=0 the result is color1; when t=1 the result is color2.',
    inputs: [
      { name: 'color1', type: 'color', description: 'The first color.' },
      { name: 'color2', type: 'color', description: 'The second color.' },
      { name: 't', type: 'number', description: 'Blend factor from 0 (all color1) to 1 (all color2).' },
    ],
    outputs: [
      { name: 'result', type: 'color', description: 'The blended color.' },
    ],
  },

  'hsl-to-rgb': {
    nodeType: 'hsl-to-rgb',
    category: 'Color',
    summary: 'Converts hue, saturation, and lightness values into an RGB color.',
    description:
      'Takes H (0-360), S (0-100), and L (0-100) components and converts them to a hex color string and individual R, G, B components (0-255).',
    inputs: [
      { name: 'h', type: 'number', description: 'Hue angle in degrees (0-360).' },
      { name: 's', type: 'number', description: 'Saturation (0 to 100).' },
      { name: 'l', type: 'number', description: 'Lightness (0 to 100).' },
    ],
    outputs: [
      { name: 'hex', type: 'color', description: 'The resulting RGB hex color string.' },
      { name: 'r', type: 'number', description: 'The red component (0-255).' },
      { name: 'g', type: 'number', description: 'The green component (0-255).' },
      { name: 'b', type: 'number', description: 'The blue component (0-255).' },
    ],
    tips: [
      'Use hue 0-360 for full spectrum: 0=red, 120=green, 240=blue.',
      'Saturation and lightness use a 0-100 scale, not 0-1.',
    ],
  },

  'rgb-to-hsl': {
    nodeType: 'rgb-to-hsl',
    category: 'Color',
    summary: 'Converts red, green, and blue components into HSL color space.',
    description:
      'Takes R, G, B numeric inputs (0-255) and converts them to hue (0-360), saturation (0-100), and lightness (0-100) components.',
    inputs: [
      { name: 'r', type: 'number', description: 'Red component (0-255).' },
      { name: 'g', type: 'number', description: 'Green component (0-255).' },
      { name: 'b', type: 'number', description: 'Blue component (0-255).' },
    ],
    outputs: [
      { name: 'h', type: 'number', description: 'Hue angle in degrees (0-360).' },
      { name: 's', type: 'number', description: 'Saturation (0 to 100).' },
      { name: 'l', type: 'number', description: 'Lightness (0 to 100).' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Live
  // ---------------------------------------------------------------------------
  timer: {
    nodeType: 'timer',
    category: 'Live',
    summary: 'Emits an incrementing tick value at a configurable time interval.',
    description:
      'Fires periodically based on the configured interval in milliseconds. Each tick increments the output value. Useful for animations, polling, or periodic updates.',
    inputs: [],
    outputs: [
      { name: 'tick', type: 'number', description: 'The current tick count, incrementing each interval.' },
    ],
    tips: [
      'This is a non-deterministic node and bypasses execution caching.',
      'Adjust intervalMs to control how frequently the timer fires.',
    ],
  },

  'http-fetch': {
    nodeType: 'http-fetch',
    category: 'Live',
    summary: 'Fetches data from a URL via HTTP and outputs the response.',
    description:
      'Makes an HTTP request to the specified URL when triggered. Returns the response data, HTTP status code, and any error message. Useful for loading external data or calling APIs.',
    inputs: [
      { name: 'url', type: 'string', description: 'The URL to fetch data from.' },
      { name: 'trigger', type: 'any', description: 'Any value change triggers a new fetch.' },
    ],
    outputs: [
      { name: 'data', type: 'any', description: 'The parsed response data (JSON or text).' },
      { name: 'status', type: 'number', description: 'The HTTP status code (e.g. 200, 404).' },
      { name: 'error', type: 'string', description: 'An error message if the request failed, empty otherwise.' },
    ],
    tips: [
      'Connect a timer to the trigger input for periodic polling.',
      'This is a non-deterministic node and bypasses execution caching.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  'create-array': {
    nodeType: 'create-array',
    category: 'Data',
    summary: 'Creates an array from a variable number of input values.',
    description:
      'Accepts a dynamic number of inputs and packs them into an ordered array. Add more inputs by connecting additional ports.',
    inputs: [
      { name: 'item0', type: 'any', description: 'First array element.' },
      { name: 'item1', type: 'any', description: 'Second array element.' },
      { name: '...', type: 'any', description: 'Additional elements (variadic).' },
    ],
    outputs: [
      { name: 'array', type: 'any', description: 'The resulting array containing all input values.' },
    ],
    tips: [
      'Connect as many inputs as needed; the node dynamically adds ports.',
    ],
  },

  'get-element': {
    nodeType: 'get-element',
    category: 'Data',
    summary: 'Retrieves a single element from an array by its index.',
    description:
      'Returns the element at the specified zero-based index. Out-of-bounds indices return undefined.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to read from.' },
      { name: 'index', type: 'number', description: 'The zero-based index of the element.' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'The element at the given index.' },
    ],
    tips: [
      'Supports negative indices to count from the end (e.g. -1 for the last element).',
    ],
  },

  'set-element': {
    nodeType: 'set-element',
    category: 'Data',
    summary: 'Replaces an element in an array at a given index.',
    description:
      'Returns a new array with the element at the specified index replaced by the given value. The original array is not modified.',
    inputs: [
      { name: 'array', type: 'any', description: 'The original array.' },
      { name: 'index', type: 'number', description: 'The zero-based index to set.' },
      { name: 'value', type: 'any', description: 'The new value for the specified index.' },
    ],
    outputs: [
      { name: 'array', type: 'any', description: 'A new array with the updated element.' },
    ],
  },

  'array-length': {
    nodeType: 'array-length',
    category: 'Data',
    summary: 'Returns the number of elements in an array.',
    description:
      'Outputs the length of the input array. Returns 0 for an empty array or if the input is not an array.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to measure.' },
    ],
    outputs: [
      { name: 'length', type: 'number', description: 'The number of elements in the array.' },
    ],
  },

  'array-push': {
    nodeType: 'array-push',
    category: 'Data',
    summary: 'Appends a value to the end of an array and returns the new array.',
    description:
      'Creates a new array that is a copy of the input array with the given value added at the end. The original array is not modified.',
    inputs: [
      { name: 'array', type: 'any', description: 'The original array.' },
      { name: 'value', type: 'any', description: 'The value to append.' },
    ],
    outputs: [
      { name: 'array', type: 'any', description: 'A new array with the value appended.' },
    ],
  },

  'array-filter': {
    nodeType: 'array-filter',
    category: 'Data',
    summary: 'Filters array elements using a JavaScript expression.',
    description:
      'Evaluates the configured expression for each element. Elements for which the expression returns a truthy value are kept; others are removed. The expression can reference the current element as `x` or `inputs[0]`.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to filter.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'A new array containing only the matching elements.' },
    ],
    tips: [
      'Expression receives `x` (current element) and `i` (index). Example: x > 5.',
      'Math object is available in expressions: Math.abs(x) < 10.',
    ],
  },

  'array-map': {
    nodeType: 'array-map',
    category: 'Data',
    summary: 'Transforms each element in an array using a JavaScript expression.',
    description:
      'Evaluates the configured expression for each element and collects the results into a new array. The expression can reference the current element as `x` or `inputs[0]`.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to transform.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'A new array with transformed elements.' },
    ],
    tips: [
      'Expression receives `x` (element) and `i` (index). Example: x * 2.',
    ],
  },

  'array-reduce': {
    nodeType: 'array-reduce',
    category: 'Data',
    summary: 'Reduces an array to a single value by applying an accumulator expression.',
    description:
      'Iterates through each element, applying the expression to accumulate a result. The expression receives `acc` (accumulator) and `x` (current element). The initial input sets the starting accumulator value.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to reduce.' },
      { name: 'initial', type: 'any', description: 'The initial accumulator value.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The accumulated result after processing all elements.' },
    ],
    tips: [
      'Expression receives `acc` (accumulator) and `x` (element). Example: acc + x.',
      'Set the initial value to 0 for summation, or [] for collecting.',
    ],
  },

  'create-object': {
    nodeType: 'create-object',
    category: 'Data',
    summary: 'Creates a JavaScript object from key-value pairs.',
    description:
      'Accepts alternating key and value inputs (key0, val0, key1, val1) and constructs an object. Useful for building structured data to pass to other nodes.',
    inputs: [
      { name: 'key0', type: 'string', description: 'The first property name.' },
      { name: 'val0', type: 'any', description: 'The first property value.' },
      { name: 'key1', type: 'string', description: 'The second property name.' },
      { name: 'val1', type: 'any', description: 'The second property value.' },
    ],
    outputs: [
      { name: 'object', type: 'any', description: 'The constructed object.' },
    ],
  },

  'get-property': {
    nodeType: 'get-property',
    category: 'Data',
    summary: 'Reads a single property from an object by key name.',
    description:
      'Looks up the specified key on the input object and returns its value. Returns undefined if the key does not exist.',
    inputs: [
      { name: 'object', type: 'any', description: 'The object to read from.' },
      { name: 'key', type: 'string', description: 'The property name to look up.' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'The value of the specified property.' },
    ],
    tips: [
      'Use dot notation in the key for nested access (e.g. "user.name") if supported by your data.',
    ],
  },

  'set-property': {
    nodeType: 'set-property',
    category: 'Data',
    summary: 'Sets or updates a property on an object and returns the new object.',
    description:
      'Creates a shallow copy of the input object with the specified key set to the given value. The original object is not modified.',
    inputs: [
      { name: 'object', type: 'any', description: 'The original object.' },
      { name: 'key', type: 'string', description: 'The property name to set.' },
      { name: 'value', type: 'any', description: 'The new value for the property.' },
    ],
    outputs: [
      { name: 'object', type: 'any', description: 'A new object with the updated property.' },
    ],
  },

  'object-keys': {
    nodeType: 'object-keys',
    category: 'Data',
    summary: 'Returns an array of all property names (keys) of an object.',
    description:
      'Equivalent to Object.keys(). Outputs an array of strings representing the enumerable property names of the input object.',
    inputs: [
      { name: 'object', type: 'any', description: 'The object to extract keys from.' },
    ],
    outputs: [
      { name: 'keys', type: 'any', description: 'An array of key strings.' },
    ],
  },

  'object-values': {
    nodeType: 'object-values',
    category: 'Data',
    summary: 'Returns an array of all property values of an object.',
    description:
      'Equivalent to Object.values(). Outputs an array containing the values of all enumerable properties of the input object.',
    inputs: [
      { name: 'object', type: 'any', description: 'The object to extract values from.' },
    ],
    outputs: [
      { name: 'values', type: 'any', description: 'An array of the property values.' },
    ],
  },

  'merge-objects': {
    nodeType: 'merge-objects',
    category: 'Data',
    summary: 'Shallowly merges two objects, with the second overriding shared keys.',
    description:
      'Combines two objects using spread syntax ({...a, ...b}). Properties from object b overwrite matching properties from object a.',
    inputs: [
      { name: 'a', type: 'any', description: 'The base object.' },
      { name: 'b', type: 'any', description: 'The object whose properties take priority.' },
    ],
    outputs: [
      { name: 'object', type: 'any', description: 'The merged object.' },
    ],
  },

  'get-var': {
    nodeType: 'get-var',
    category: 'Data',
    summary: 'Reads a named graph variable and outputs its current value.',
    description:
      'Retrieves the value of a shared graph variable by name. Graph variables allow nodes to communicate without direct connections. Returns 0 if the variable has not been set.',
    inputs: [],
    outputs: [
      { name: 'value', type: 'any', description: 'The current value of the named variable.' },
    ],
    tips: [
      'Configure the variable name in the node data panel.',
      'Pair with set-var nodes to create indirect data flow.',
    ],
  },

  'set-var': {
    nodeType: 'set-var',
    category: 'Data',
    summary: 'Writes a value to a named graph variable for other nodes to read.',
    description:
      'Stores the input value into a shared graph variable identified by name. Other get-var nodes with the same variable name will read this value. Also passes the value through as output.',
    inputs: [
      { name: 'value', type: 'any', description: 'The value to store in the variable.' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'The same value, passed through.' },
    ],
    tips: [
      'Variable names are scoped to the current graph (not shared across subgraphs).',
    ],
  },

  'json-parse': {
    nodeType: 'json-parse',
    category: 'Data',
    summary: 'Parses a JSON string into a JavaScript value.',
    description:
      'Applies JSON.parse() to the input string. The output can be an object, array, number, string, boolean, or null depending on the JSON content. Throws an error for invalid JSON.',
    inputs: [
      { name: 'json', type: 'string', description: 'A valid JSON string to parse.' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'The parsed JavaScript value.' },
    ],
  },

  'json-stringify': {
    nodeType: 'json-stringify',
    category: 'Data',
    summary: 'Serializes a JavaScript value into a JSON string.',
    description:
      'Applies JSON.stringify() to the input value. When the pretty flag is true the output is formatted with indentation for readability.',
    inputs: [
      { name: 'value', type: 'any', description: 'The value to serialize.' },
      { name: 'pretty', type: 'boolean', description: 'When true, outputs formatted JSON with indentation.' },
    ],
    outputs: [
      { name: 'json', type: 'string', description: 'The JSON string representation.' },
    ],
  },

  'base64-encode': {
    nodeType: 'base64-encode',
    category: 'Data',
    summary: 'Encodes a text string into Base64 format.',
    description:
      'Converts the input text to a Base64-encoded string. Useful for encoding data for transmission in URLs, headers, or other text-only contexts.',
    inputs: [
      { name: 'text', type: 'string', description: 'The plain text to encode.' },
    ],
    outputs: [
      { name: 'encoded', type: 'string', description: 'The Base64-encoded string.' },
    ],
  },

  'base64-decode': {
    nodeType: 'base64-decode',
    category: 'Data',
    summary: 'Decodes a Base64 string back into plain text.',
    description:
      'Converts a Base64-encoded string back to its original text form. Returns an error if the input is not valid Base64.',
    inputs: [
      { name: 'encoded', type: 'string', description: 'The Base64-encoded string to decode.' },
    ],
    outputs: [
      { name: 'text', type: 'string', description: 'The decoded plain text.' },
    ],
  },

  'uri-encode': {
    nodeType: 'uri-encode',
    category: 'Data',
    summary: 'Encodes a string for safe use in a URI component.',
    description:
      'Applies encodeURIComponent() to the input string, escaping special characters so the string can be safely embedded in a URL.',
    inputs: [
      { name: 'text', type: 'string', description: 'The text to encode for URI usage.' },
    ],
    outputs: [
      { name: 'encoded', type: 'string', description: 'The URI-encoded string.' },
    ],
  },

  'uri-decode': {
    nodeType: 'uri-decode',
    category: 'Data',
    summary: 'Decodes a URI-encoded string back to its original form.',
    description:
      'Applies decodeURIComponent() to the input string, converting percent-encoded characters back to their original representation.',
    inputs: [
      { name: 'encoded', type: 'string', description: 'The URI-encoded string to decode.' },
    ],
    outputs: [
      { name: 'text', type: 'string', description: 'The decoded string.' },
    ],
  },

  'array-slice': {
    nodeType: 'array-slice',
    category: 'Data',
    summary: 'Extracts a contiguous portion of an array between start and end indices.',
    description:
      'Returns a new array containing elements from the start index (inclusive) to the end index (exclusive). Negative indices count from the end of the array.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to slice.' },
      { name: 'start', type: 'number', description: 'The start index (inclusive).' },
      { name: 'end', type: 'number', description: 'The end index (exclusive).' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'The sliced sub-array.' },
    ],
    tips: [
      'Omit or set end to a large number to slice from start to the end of the array.',
    ],
  },

  'array-find': {
    nodeType: 'array-find',
    category: 'Data',
    summary: 'Finds the first array element matching a JavaScript expression.',
    description:
      'Evaluates the expression for each element and returns the first element for which the expression is truthy. Also outputs the index of the found element, or -1 if not found.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to search.' },
      { name: 'expr', type: 'string', description: 'Expression (x, i) returning truthy for a match.' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'The first matching element, or null.' },
      { name: 'index', type: 'number', description: 'The index of the match, or -1 if not found.' },
    ],
    tips: [
      'Expression receives `x` (current element) and `i` (index). Example: x.name === "target".',
    ],
  },

  'array-sort': {
    nodeType: 'array-sort',
    category: 'Data',
    summary: 'Sorts array elements using an optional comparator expression.',
    description:
      'Returns a new sorted array. If a comparator expression is provided, it receives `a` and `b` and should return a negative number, zero, or positive number. Without an expression, elements are sorted using default comparison.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to sort.' },
    ],
    outputs: [
      { name: 'sorted', type: 'any', description: 'A new sorted array.' },
    ],
    tips: [
      'Comparator expression receives `a` and `b`. Example: a - b for ascending numeric sort.',
    ],
  },

  'array-reverse': {
    nodeType: 'array-reverse',
    category: 'Data',
    summary: 'Reverses the order of elements in an array.',
    description:
      'Returns a new array with elements in the opposite order. The original array is not modified.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array to reverse.' },
    ],
    outputs: [
      { name: 'reversed', type: 'any', description: 'A new array with reversed element order.' },
    ],
  },

  'array-flatten': {
    nodeType: 'array-flatten',
    category: 'Data',
    summary: 'Flattens nested arrays to a specified depth.',
    description:
      'Recursively concatenates sub-arrays up to the specified depth. A depth of 1 flattens one level; Infinity flattens completely. Default depth is 1.',
    inputs: [
      { name: 'array', type: 'any', description: 'The nested array to flatten.' },
      { name: 'depth', type: 'number', description: 'The maximum flattening depth (default 1).' },
    ],
    outputs: [
      { name: 'flat', type: 'any', description: 'The flattened array.' },
    ],
    tips: [
      'Set depth to Infinity to completely flatten deeply nested arrays.',
    ],
  },

  'array-zip': {
    nodeType: 'array-zip',
    category: 'Data',
    summary: 'Combines two arrays into an array of paired elements.',
    description:
      'Takes two arrays and returns a new array of [a[i], b[i]] pairs. The result length equals the shorter of the two input arrays.',
    inputs: [
      { name: 'a', type: 'any', description: 'The first array.' },
      { name: 'b', type: 'any', description: 'The second array.' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'An array of [a[i], b[i]] pairs.' },
    ],
  },

  'array-unique': {
    nodeType: 'array-unique',
    category: 'Data',
    summary: 'Removes duplicate values from an array.',
    description:
      'Returns a new array with only unique elements, preserving the order of first occurrence. Uses strict equality (===) for comparison. Also outputs the count of unique elements.',
    inputs: [
      { name: 'array', type: 'any', description: 'The array with possible duplicates.' },
    ],
    outputs: [
      { name: 'unique', type: 'any', description: 'A new array with duplicates removed.' },
      { name: 'count', type: 'number', description: 'The number of unique elements.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Utility (Date/Time)
  // ---------------------------------------------------------------------------
  'get-timestamp': {
    nodeType: 'get-timestamp',
    category: 'Utility',
    summary: 'Returns the current Unix timestamp in milliseconds.',
    description:
      'Outputs Date.now(), the number of milliseconds elapsed since January 1, 1970 00:00:00 UTC. This is a non-deterministic node that bypasses execution caching.',
    inputs: [],
    outputs: [
      { name: 'timestamp', type: 'number', description: 'Current Unix timestamp in milliseconds.' },
    ],
    tips: [
      'This node bypasses execution caching because its output changes each execution.',
    ],
  },

  'format-date': {
    nodeType: 'format-date',
    category: 'Utility',
    summary: 'Formats a Unix timestamp into ISO, date, and time strings.',
    description:
      'Converts a numeric timestamp (milliseconds since epoch) into three output formats: a full ISO 8601 string, a date part (YYYY-MM-DD), and a time part (HH:MM:SS).',
    inputs: [
      { name: 'timestamp', type: 'number', description: 'Unix timestamp in milliseconds.' },
    ],
    outputs: [
      { name: 'iso', type: 'string', description: 'The full ISO 8601 date string.' },
      { name: 'date', type: 'string', description: 'The date part (YYYY-MM-DD).' },
      { name: 'time', type: 'string', description: 'The time part (HH:MM:SS).' },
    ],
  },

  'parse-date': {
    nodeType: 'parse-date',
    category: 'Utility',
    summary: 'Parses a date string into a Unix timestamp in milliseconds.',
    description:
      'Attempts to parse the input string as a date and returns the corresponding Unix timestamp. Returns 0 and valid=false if the string cannot be parsed. Uses JavaScript Date parsing rules.',
    inputs: [
      { name: 'dateStr', type: 'string', description: 'The date string to parse.' },
    ],
    outputs: [
      { name: 'timestamp', type: 'number', description: 'The parsed Unix timestamp in milliseconds, or 0 on failure.' },
      { name: 'valid', type: 'boolean', description: 'Whether the date string was successfully parsed.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Subgraph
  // ---------------------------------------------------------------------------
  subgraph: {
    nodeType: 'subgraph',
    category: 'Subgraph',
    summary: 'Encapsulates a sub-graph as a reusable node with dynamic ports.',
    description:
      'A subgraph node contains an inner graph that can be entered and edited. Its input and output ports are defined by subgraph-input and subgraph-output nodes inside. Execution recursively evaluates the inner graph with a depth limit of 10.',
    inputs: [
      { name: '(dynamic)', type: 'any', description: 'Inputs are defined by subgraph-input nodes inside the subgraph.' },
    ],
    outputs: [
      { name: '(dynamic)', type: 'any', description: 'Outputs are defined by subgraph-output nodes inside the subgraph.' },
    ],
    tips: [
      'Double-click to enter the subgraph and edit its contents.',
      'Subgraphs can be nested up to 10 levels deep.',
    ],
  },

  'subgraph-input': {
    nodeType: 'subgraph-input',
    category: 'Subgraph',
    summary: 'Defines an external input port on the parent subgraph node.',
    description:
      'Placed inside a subgraph to create an input port on the containing subgraph node. The value received from the parent graph is available at this node\'s output.',
    inputs: [],
    outputs: [
      { name: 'value', type: 'any', description: 'The value passed in from the parent graph.' },
    ],
    tips: [
      'Each subgraph-input node adds one input port to the parent subgraph node.',
    ],
  },

  'subgraph-output': {
    nodeType: 'subgraph-output',
    category: 'Subgraph',
    summary: 'Defines an external output port on the parent subgraph node.',
    description:
      'Placed inside a subgraph to create an output port on the containing subgraph node. The value connected to this node\'s input is sent back to the parent graph.',
    inputs: [
      { name: 'value', type: 'any', description: 'The value to send back to the parent graph.' },
    ],
    outputs: [],
    tips: [
      'Each subgraph-output node adds one output port to the parent subgraph node.',
    ],
  },

  custom: {
    nodeType: 'custom',
    category: 'Utility',
    summary: 'A user-defined node that evaluates a custom JavaScript expression.',
    description:
      'Has dynamic inputs and outputs. The configured expression is evaluated as a JavaScript function with access to the input values. Supports both `inputs[0]` and `in0` syntax for referencing inputs.',
    inputs: [
      { name: '(dynamic)', type: 'any', description: 'Inputs are configurable and accessed via inputs[N] or inN in the expression.' },
    ],
    outputs: [
      { name: '(dynamic)', type: 'any', description: 'Outputs are configurable and set by the expression return value.' },
    ],
    tips: [
      'Access inputs as inputs[0], inputs[1] or shorthand in0, in1.',
      'Global objects (window, document, eval) are shadowed for security.',
    ],
  },
};

/**
 * Retrieves the help entry for a specific node type.
 */
export function getNodeHelp(type: NodeType | string): NodeHelpEntry | undefined {
  return NODE_HELP[type];
}

/**
 * Returns all node help entries as an array.
 */
export function getAllNodeHelp(): NodeHelpEntry[] {
  return Object.values(NODE_HELP);
}

/**
 * Returns all node help entries belonging to a specific category.
 */
export function getNodeHelpByCategory(category: string): NodeHelpEntry[] {
  return Object.values(NODE_HELP).filter(h => h.category === category);
}
