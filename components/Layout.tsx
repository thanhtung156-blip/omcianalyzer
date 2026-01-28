
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200">
      <header className="h-16 border-b border-slate-800 flex items-center px-6 justify-between bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 print:hidden">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <i className="fas fa-microchip text-white text-xl"></i>
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-white">OMCI<span className="text-blue-500">Analyzer</span></h1>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">GPON G.988 Diagnostics</p>
          </div>
        </div>
        <nav className="flex items-center gap-6">
        </nav>
      </header>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <footer className="h-10 border-t border-slate-900 flex items-center px-6 justify-between text-[10px] text-slate-500 bg-slate-950 print:hidden">
        <p>&copy; 2024 OMCI Analyzer Pro</p>
        <p>Compliance: ITU-T G.988 | Version 0.1</p>
      </footer>
    </div>
  );
};

export default Layout;
