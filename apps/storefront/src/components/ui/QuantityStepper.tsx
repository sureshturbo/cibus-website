import Icon from "../Icon.js";

interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  label: string;
  onChange: (next: number) => void;
}

/**
 * Plus/minus stepper around a number input.
 *
 * The input is editable as well as steppable, and is clamped on blur so a
 * half-typed value never reaches the cart.
 */
export default function QuantityStepper({
  value,
  min = 1,
  max = 99,
  disabled = false,
  label,
  onChange,
}: QuantityStepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="qty">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Icon name="minus" size={16} />
      </button>

      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(clamp(Number(event.target.value) || min))}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}