import React, { ReactNode } from 'react';

interface PageLayoutProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  description?: string;
}

const PageLayout: React.FC<PageLayoutProps> = ({ title, children, action, description }) => {
  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500 break-words">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0 flex flex-wrap gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
};

export default PageLayout;
