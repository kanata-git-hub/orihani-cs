import React from 'react';
import { LucideIcon } from 'lucide-react';

interface TagSelectorProps {
  icon: LucideIcon;
  title: string;
  options: string[];
  selectedOptions: string[];
  onToggle: (option: string) => void;
}

export const TagSelector: React.FC<TagSelectorProps> = ({ icon: Icon, title, options, selectedOptions, onToggle }) => {
  return (
    <div className="space-y-2">
      <label className="text-base sm:text-xl font-bold sm:tracking-widest text-[#552c24] flex items-center gap-2">
        <Icon size={20} />
        {title}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            aria-pressed={selectedOptions.includes(option)}
            className={`min-h-11 px-3 sm:px-5 py-2 sm:py-3 rounded-2xl sm:rounded-full text-sm sm:text-lg font-bold transition-all border ${
              selectedOptions.includes(option)
                ? 'bg-[#ffcd4a] text-[#552c24] border-[#ffcd4a] shadow-md'
                : 'bg-white text-[#552c24]/70 border-[#552c24]/20 hover:border-[#ffcd4a]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};
