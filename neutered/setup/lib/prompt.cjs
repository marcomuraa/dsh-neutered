'use strict'

// The one question setup asks. Non-interactive runs (--yes, or stdin not a TTY) take the default.

const readline = require('node:readline')

async function ask(question, defaultValue, { yes = false, input = process.stdin, output = process.stdout } = {}) {
  if (yes || !input.isTTY) {
    output.write(`${question} [${defaultValue}] (accepted automatically)\n`)
    return String(defaultValue)
  }
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [${defaultValue}]: `, resolve))
    const trimmed = answer.trim()
    return trimmed === '' ? String(defaultValue) : trimmed
  } finally {
    rl.close()
  }
}

module.exports = { ask }
