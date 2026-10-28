import React, { useId } from 'react';
import { Check, LucideIcon } from 'lucide-react';

interface TagGroup {
  title: string;
  options: string[];
}

interface TagSelectorProps {
  icon: LucideIcon;
  title: string;
  groups: TagGroup[];
  tone: 'teal' | 'amber' | 'violet';
  optionLabels?: Record<string, string>;
  selectedOptions: string[];
  onToggle: (option: string) => void;
}

const tones = {
  teal: {
    panel: 'border-teal-200 bg-teal-50/50',
    heading: 'text-teal-900',
    icon: 'bg-teal-100 text-teal-800',
    divider: 'border-teal-200/70',
    selected: 'bg-teal-700 text-white border-teal-700',
    idle: 'bg-white text-teal-950 border-teal-200 hover:border-teal-500 hover:bg-teal-50',
    focus: 'focus-visible:ring-teal-600'
  },
  amber: {
    panel: 'border-amber-200 bg-amber-50/60',
    heading: 'text-amber-950',
    icon: 'bg-amber-100 text-amber-900',
    divider: 'border-amber-200/70',
    selected: 'bg-amber-300 text-amber-950 border-amber-400',
    idle: 'bg-white text-amber-950 border-amber-200 hover:border-amber-500 hover:bg-amber-50',
    focus: 'focus-visible:ring-amber-600'
  },
  violet: {
    panel: 'border-violet-200 bg-violet-50/50',
    heading: 'text-violet-950',
    icon: 'bg-violet-100 text-violet-800',
    divider: 'border-violet-200/70',
    selected: 'bg-violet-700 text-white border-violet-700',
    idle: 'bg-white text-violet-950 border-violet-200 hover:border-violet-500 hover:bg-violet-50',
    focus: 'focus-visible:ring-violet-600'
  }
};

export const TagSelector: React.FC<TagSelectorProps> = ({
  icon: Icon, title, groups, tone, optionLabels = {}, selectedOptions, onToggle
}) => {
  const headingId = useId();
  const colors = tones[tone];

  return (
    <section aria-labelledby={headingId} className={`min-w-0 rounded-2xl sm:rounded-3xl border p-3 sm:p-5 ${colors.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 id={headingId} className={`flex items-center gap-2.5 text-xl font-bold ${colors.heading}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${colors.icon}`}>
            <Icon size={20} aria-hidden="true" />
          </span>
          {title}
        </h2>
        <span className={`text-sm ${colors.heading}`}>중복 선택 가능</span>
      </div>
      <div className="space-y-4 sm:space-y-3">
        {groups.map((group, index) => (
          <div key={group.title} role="group" aria-label={group.title}
            className={`grid min-w-0 gap-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4 ${index > 0 ? `border-t pt-4 sm:pt-3 ${colors.divider}` : ''}`}>
            <p className={`text-base font-bold sm:pt-3 ${colors.heading}`}>{group.title}</p>
            <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-2">
              {group.options.map(option => {
                const selected = selectedOptions.includes(option);
                const label = optionLabels[option] || option;
                return (
                  <button key={option} type="button" onClick={() => onToggle(option)}
                    aria-pressed={selected}
                    className={`inline-flex min-w-0 max-w-full min-h-12 sm:min-h-11 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 py-2.5 sm:py-2 text-lg font-bold text-left leading-normal sm:leading-snug ${label.length > 14 || group.options.length === 1 ? 'col-span-2 sm:col-auto' : ''} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${colors.focus} ${selected ? colors.selected : colors.idle}`}>
                    <Check size={16} aria-hidden="true" className={`shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="min-w-0 break-words">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
