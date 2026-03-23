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
      <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 sm:gap-4 min-w-0 w-full shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500 break-words">{description}</p>}
        </div>
        {action && (
          <div className="w-full lg:w-auto lg:max-w-[65%] flex flex-wrap gap-2 items-start justify-end lg:justify-start">
            {action}
          </div>
        )}
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
};

export default PageLayout;
