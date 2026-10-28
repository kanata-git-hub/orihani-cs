import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ResultCardProps {
  icon: LucideIcon;
  title: string;
  content: React.ReactNode;
  actionButton?: React.ReactNode;
  isHighlighted?: boolean;
  className?: string;
}

export const ResultCard: React.FC<ResultCardProps> = ({ icon: Icon, title, content, actionButton, isHighlighted, className = '' }) => {
  return (
    <div className={`min-w-0 space-y-3 sm:space-y-6 ${className}`}>
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 sm:gap-2">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 text-[#552c24]">
          <div className="shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[#ffcd4a]/30 flex items-center justify-center">
            <Icon size={24} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold leading-relaxed sm:leading-8 sm:tracking-widest">{title}</h2>
        </div>
        {actionButton}
      </div>
      
      <div className={`bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[32px] shadow-md ${
        isHighlighted 
          ? 'border-2 border-[#ffcd4a] ring-4 ring-[#ffcd4a]/10' 
          : 'border border-[#552c24]/10'
      }`}>
        <div className={`whitespace-pre-wrap break-words leading-[1.85] sm:leading-relaxed space-y-3 ${
          isHighlighted ? 'text-[#552c24] text-lg sm:text-2xl font-bold' : 'text-[#552c24] text-lg sm:text-xl font-medium'
        }`}>
          {content}
        </div>
      </div>
    </div>
  );
};
