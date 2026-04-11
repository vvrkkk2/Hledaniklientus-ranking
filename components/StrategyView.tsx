import React from 'react';
import { Segment } from '../types';
import { Lightbulb, Target, Edit3 } from 'lucide-react';

interface StrategyViewProps {
  segments: Segment[];
  onUpdateSegment: (id: string, notes: string) => void;
  onContinue: () => void;
  isProcessing: boolean;
}

const StrategyView: React.FC<StrategyViewProps> = ({ segments, onUpdateSegment, onContinue, isProcessing }) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
        <h2 className="text-xl font-bold text-slate-800 flex items-center justify-center gap-2 mb-2">
          <Target className="w-6 h-6 text-indigo-600" />
          Strategie Outreachu
        </h2>
        <p className="text-slate-600 max-w-2xl mx-auto">
          AI rozdělila vaše kontakty do skupin. Nyní napište ke každé skupině své "myšlenky". 
          <br/>
          <i>Co jim chcete nabídnout? Jaký problém jim řešíte?</i>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {segments.map((segment) => (
          <div key={segment.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex items-start gap-3">
              <div className="bg-white p-2 rounded-lg shadow-sm">
                <Lightbulb className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{segment.name}</h3>
                <p className="text-xs text-slate-500">{segment.description}</p>
              </div>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
                Vaše myšlenky pro AI (Instrukce)
              </label>
              <textarea
                className="w-full flex-1 min-h-[120px] p-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                placeholder={`Např.: Nabídni jim naše nové SEO služby speciálně pro ${segment.name}. Zmiň, že jim pomůžeme zvýšit organickou návštěvnost.`}
                value={segment.userNotes || ''}
                onChange={(e) => onUpdateSegment(segment.id, e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={onContinue}
          disabled={isProcessing}
          className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Analyzuji...' : (
            <>
              <Edit3 className="w-5 h-5" />
              Spustit Generování E-mailů
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default StrategyView;
