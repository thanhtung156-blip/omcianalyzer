
import { AnalysisResult, MeStats } from '../types';

export const exportToJSON = (data: AnalysisResult) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OMCI_Analysis_Export_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportToCSV = (data: AnalysisResult) => {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "ME Class Name,Count,Instances\n";
  
  (Object.values(data.stats) as MeStats[]).forEach((stat) => {
    csvContent += `"${stat.className}",${stat.count},"${stat.instances.join('; ')}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `OMCI_Stats_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const triggerPrint = () => {
  window.print();
};
