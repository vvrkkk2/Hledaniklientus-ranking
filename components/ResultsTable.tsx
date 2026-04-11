import React from 'react';
import { ScanResult, ScanStatus } from '../types';
import { CheckCircle2, XCircle, Loader2, Mail, ExternalLink, AlertCircle, Copy, Download } from 'lucide-react';

interface ResultsTableProps {
  results: ScanResult[];
}

const ResultsTable: React.FC<ResultsTableProps> = ({ results }) => {
  if (results.length === 0) return null;

  const completedCount = results.filter(r => r.status === ScanStatus.COMPLETED || r.status === ScanStatus.FAILED).length;
  // Fallback if enrichedData is missing
  const foundCount = results.filter(r => r.enrichedData?.email).length;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const escapeCsv = (val: string | undefined | null) => {
    if (!val) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + "URL,Email,Role,Status\n"
      + results.map(r => `${escapeCsv(r.url)},${escapeCsv(r.enrichedData?.email)},${escapeCsv(r.enrichedData?.personRole)},${r.status}`).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "emaily_export_ai.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Simplified legacy view */}
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h3 className="font-semibold text-slate-800">Výsledky</h3>
          <p className="text-sm text-slate-500">
            Zpracováno {completedCount} z {results.length}
          </p>
        </div>
        <button onClick={handleExport} className="text-blue-600 font-medium text-sm">Export CSV</button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <th className="px-4 py-3 font-medium w-1/4">Webová stránka</th>
              <th className="px-4 py-3 font-medium w-1/4">E-mail</th>
              <th className="px-4 py-3 font-medium w-24 text-right">Stav</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.map((result) => (
              <tr key={result.id}>
                <td className="px-4 py-3 font-medium text-slate-800 truncate max-w-[200px]">
                    {result.url}
                </td>
                <td className="px-4 py-3">
                  {result.enrichedData?.email || '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  {result.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;
