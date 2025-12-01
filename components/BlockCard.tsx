import React from 'react';
import { ScriptBlock } from '../types';

interface BlockCardProps {
  title: string;
  color: string;
  blockData: ScriptBlock; // Now accepts a single ScriptBlock object
  onBlockDataChange: (data: ScriptBlock) => void; // Callback for changes to the entire block
  readOnly?: boolean; // New prop for disabling inputs
}

const BlockCard: React.FC<BlockCardProps> = ({ 
  title, 
  color, 
  blockData,
  onBlockDataChange,
  readOnly = false // Default to false
}) => {
  
  // Tailwind dynamic color classes
  const borderColor = {
    'primary': 'border-indigo-600',
    'secondary': 'border-purple-600',
    'tertiary': 'border-pink-600',
    'quaternary': 'border-indigo-600'
  }[color] || 'border-gray-500';

  const textColor = {
    'primary': 'text-indigo-800',
    'secondary': 'text-purple-800',
    'tertiary': 'text-pink-800',
    'quaternary': 'text-indigo-800'
  }[color] || 'text-gray-800';

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onBlockDataChange({ ...blockData, text: e.target.value });
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onBlockDataChange({ ...blockData, prompt: e.target.value });
  };

  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border-l-4 ${borderColor} mb-4 transition-all hover:shadow-md`}>
      <h3 className={`font-bold text-lg mb-3 ${textColor}`}>{title}</h3>
      
      <div className="mb-3">
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
          Texto Falado (PT-BR)
        </label>
        <textarea
          rows={4}
          className={`w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y ${readOnly ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}
          value={blockData.text || ''} // Provide fallback empty string
          onChange={handleTextChange}
          readOnly={readOnly}
          disabled={readOnly}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
          Image Prompt (English)
        </label>
        <textarea
          rows={2}
          className={`w-full p-2 text-xs border border-gray-200 rounded-lg text-gray-600 italic focus:ring-2 focus:ring-indigo-500 outline-none ${readOnly ? 'bg-slate-100 cursor-not-allowed' : 'bg-gray-50'}`}
          value={blockData.prompt || ''} // Provide fallback empty string
          onChange={handlePromptChange}
          readOnly={readOnly}
          disabled={readOnly}
        />
      </div>
    </div>
  );
};

export default BlockCard;