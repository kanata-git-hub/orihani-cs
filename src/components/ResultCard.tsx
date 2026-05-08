import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ResultCardProps {
  icon: LucideIcon;
  title: string;
  content: React.ReactNode;
  actionButton?: React.ReactNode;
  isHighlighted?: boolean;
}

export const ResultCard: React.FC<ResultCardProps> = ({ icon: Icon, title, content, actionButton, isHighlighted }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[#552c24]">
          <div className="w-10 h-10 rounded-xl bg-[#ffcd4a]/30 flex items-center justify-center">
            <Icon size={24} />
          </div>
          <h2 className="text-2xl font-bold uppercase tracking-widest">{title}</h2>
        </div>
        {actionButton}
      </div>
      
      <div className={`bg-white p-8 rounded-[32px] shadow-md h-full ${
        isHighlighted 
          ? 'border-2 border-[#ffcd4a] ring-4 ring-[#ffcd4a]/10' 
          : 'border border-[#552c24]/10'
      }`}>
        <div className={`whitespace-pre-wrap leading-relaxed space-y-3 ${
          isHighlighted ? 'text-[#552c24] text-2xl font-bold' : 'text-[#552c24] text-xl font-medium'
        }`}>
          {content}
        </div>
      </div>
    </div>
  );
};
