import { useState, useCallback } from 'react'
import './Calculator.css'

type Operation = '+' | '-' | '×' | '÷' | null

interface CalcState {
  display: string
  prevValue: number | null
  operation: Operation
  waitingForOperand: boolean
}

const initialState: CalcState = {
  display: '0',
  prevValue: null,
  operation: null,
  waitingForOperand: false,
}

export default function Calculator() {
  const [state, setState] = useState<CalcState>(initialState)

  const inputDigit = useCallback((digit: string) => {
    setState((prev) => {
      if (prev.waitingForOperand) {
        return { ...prev, display: digit, waitingForOperand: false }
      }
      if (prev.display === '0' && digit !== '.') {
        return { ...prev, display: digit }
      }
      if (digit === '.' && prev.display.includes('.')) {
        return prev
      }
      return { ...prev, display: prev.display + digit }
    })
  }, [])

  const inputOperation = useCallback((op: Operation) => {
    setState((prev) => {
      const current = parseFloat(prev.display)
      if (prev.prevValue !== null && !prev.waitingForOperand) {
        const result = calculate(prev.prevValue, current, prev.operation)
        return {
          display: formatResult(result),
          prevValue: result,
          operation: op,
          waitingForOperand: true,
        }
      }
      return {
        ...prev,
        prevValue: current,
        operation: op,
        waitingForOperand: true,
      }
    })
  }, [])

  const handleEquals = useCallback(() => {
    setState((prev) => {
      if (prev.prevValue === null || prev.operation === null) return prev
      const current = parseFloat(prev.display)
      const result = calculate(prev.prevValue, current, prev.operation)
      return {
        display: formatResult(result),
        prevValue: null,
        operation: null,
        waitingForOperand: true,
      }
    })
  }, [])

  const handleToggleSign = useCallback(() => {
    setState((prev) => ({
      ...prev,
      display: formatResult(parseFloat(prev.display) * -1),
    }))
  }, [])

  const handlePercent = useCallback(() => {
    setState((prev) => ({
      ...prev,
      display: formatResult(parseFloat(prev.display) / 100),
    }))
  }, [])

  const handleClear = useCallback(() => {
    setState(initialState)
  }, [])

  const handleBackspace = useCallback(() => {
    setState((prev) => {
      if (prev.waitingForOperand) return prev
      const next = prev.display.slice(0, -1)
      return { ...prev, display: next === '' || next === '-' ? '0' : next }
    })
  }, [])

  const buttons: Array<{ label: string; type: 'fn' | 'op' | 'num' | 'eq'; action: () => void }> = [
    { label: 'AC', type: 'fn', action: handleClear },
    { label: '+/-', type: 'fn', action: handleToggleSign },
    { label: '%', type: 'fn', action: handlePercent },
    { label: '÷', type: 'op', action: () => inputOperation('÷') },

    { label: '7', type: 'num', action: () => inputDigit('7') },
    { label: '8', type: 'num', action: () => inputDigit('8') },
    { label: '9', type: 'num', action: () => inputDigit('9') },
    { label: '×', type: 'op', action: () => inputOperation('×') },

    { label: '4', type: 'num', action: () => inputDigit('4') },
    { label: '5', type: 'num', action: () => inputDigit('5') },
    { label: '6', type: 'num', action: () => inputDigit('6') },
    { label: '-', type: 'op', action: () => inputOperation('-') },

    { label: '1', type: 'num', action: () => inputDigit('1') },
    { label: '2', type: 'num', action: () => inputDigit('2') },
    { label: '3', type: 'num', action: () => inputDigit('3') },
    { label: '+', type: 'op', action: () => inputOperation('+') },

    { label: '⌫', type: 'fn', action: handleBackspace },
    { label: '0', type: 'num', action: () => inputDigit('0') },
    { label: '.', type: 'num', action: () => inputDigit('.') },
    { label: '=', type: 'eq', action: handleEquals },
  ]

  return (
    <div className="calculator">
      <div className="display">
        <div className="display-operation">
          {state.prevValue !== null ? `${formatResult(state.prevValue)} ${state.operation ?? ''}` : ''}
        </div>
        <div className="display-value">{state.display}</div>
      </div>
      <div className="buttons">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            className={`btn btn-${btn.type}`}
            onClick={btn.action}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function calculate(a: number, b: number, op: Operation): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '×': return a * b
    case '÷': return b !== 0 ? a / b : 0
    default: return b
  }
}

function formatResult(value: number): string {
  if (!isFinite(value)) return '0'
  const str = parseFloat(value.toPrecision(12)).toString()
  return str
}
