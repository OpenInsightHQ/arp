/* eslint-disable i18next/no-literal-string */
import React, { useState } from 'react';
import { cn } from '~/utils';
import {
  submitTaskQueueItem,
  type TaskQueueItem,
  type TaskFormField,
} from 'librechat-data-provider';

interface TaskFormProps {
  task: TaskQueueItem;
  onSubmitted?: () => void;
}

export default function TaskForm({ task, onSubmitted }: TaskFormProps) {
  const [formResponse, setFormResponse] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (response: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      await submitTaskQueueItem(task._id, response);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (task.formType === 'confirmation') {
    return (
      <div className="mt-2 flex gap-2">
        <button
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-emerald-500 text-white hover:bg-emerald-600',
            submitting && 'cursor-not-allowed opacity-50',
          )}
          disabled={submitting}
          onClick={() => handleSubmit({ confirmed: true })}
        >
          Confirm
        </button>
        <button
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-red-500 text-white hover:bg-red-600',
            submitting && 'cursor-not-allowed opacity-50',
          )}
          disabled={submitting}
          onClick={() => handleSubmit({ confirmed: false })}
        >
          Reject
        </button>
        {error && <span className="self-center text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  if (task.formType === 'choice' && task.choices) {
    return (
      <div className="mt-2 space-y-1.5">
        {task.choices.map((choice) => (
          <button
            key={choice.value}
            className={cn(
              'block w-full rounded-md border px-3 py-2 text-left text-xs transition-colors',
              'border-border-medium hover:border-border-xheavy hover:bg-surface-tertiary',
              submitting && 'cursor-not-allowed opacity-50',
            )}
            disabled={submitting}
            onClick={() => handleSubmit({ choice: choice.value })}
          >
            <span className="font-medium">{choice.label}</span>
            {choice.description && (
              <span className="mt-0.5 block text-text-secondary">{choice.description}</span>
            )}
          </button>
        ))}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  if (task.formType === 'form' && task.fields) {
    const updateField = (name: string, value: unknown) => {
      setFormResponse((prev) => ({ ...prev, [name]: value }));
    };

    return (
      <div className="mt-2 space-y-3">
        {task.fields.map((field) => (
          <FormFields
            key={field.name}
            field={field}
            value={formResponse[field.name]}
            onChange={(v) => updateField(field.name, v)}
          />
        ))}
        <button
          className={cn(
            'rounded-md px-4 py-1.5 text-xs font-medium',
            'bg-blue-500 text-white hover:bg-blue-600',
            submitting && 'cursor-not-allowed opacity-50',
          )}
          disabled={submitting}
          onClick={() => handleSubmit(formResponse)}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
        {error && <span className="block text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        className={cn(
          'w-full resize-none rounded-md border px-3 py-2 text-xs',
          'border-border-medium bg-surface-primary',
          'focus:outline-none focus:ring-1 focus:ring-blue-500',
        )}
        rows={3}
        placeholder="Type your response..."
        value={(formResponse.text as string) ?? ''}
        onChange={(e) => setFormResponse((prev) => ({ ...prev, text: e.target.value }))}
      />
      <button
        className={cn(
          'rounded-md px-4 py-1.5 text-xs font-medium',
          'bg-blue-500 text-white hover:bg-blue-600',
          submitting && 'cursor-not-allowed opacity-50',
        )}
        disabled={submitting || !formResponse.text}
        onClick={() => handleSubmit(formResponse)}
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </button>
      {error && <span className="block text-xs text-red-500">{error}</span>}
    </div>
  );
}

function FormFields({
  field,
  value,
  onChange,
}: {
  field: TaskFormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const baseClass =
    'w-full px-2 py-1.5 text-xs rounded-md border border-border-medium bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-500';

  if (field.fieldType === 'textarea') {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-text-primary">
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </label>
        <textarea
          className={cn(baseClass, 'resize-none')}
          rows={2}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.fieldType === 'select' && field.options) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-text-primary">
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </label>
        <select
          className={baseClass}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.fieldType === 'number') {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-text-primary">
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </label>
        <input
          type="number"
          className={baseClass}
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-primary">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type="text"
        className={baseClass}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
