import React, { useState, useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PageLayout from '../components/PageLayout';
import { CurrencyContext } from '../context/CurrencyContext';
import { format } from 'date-fns';
import { 
  ChartBarIcon, 
  AcademicCapIcon, 
  CalendarDaysIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon
} from '../components/icons';

interface LifeEvent {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amount: number;
  timing: string;
  description: string;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  incomeMultiplier: number;
  expenseMultiplier: number;
  duration: number;
  color: string;
}

const Plan: React.FC<{ setActivePage: (page: string) => void }> = ({ }) => {
  const { data, loading } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { currency } = useContext(CurrencyContext);

  const [selectedScenario, setSelectedScenario] = useState<string>('none');

  const scenarios: Scenario[] = [
    { id: 'none', name: 'None', description: 'Current financial situation', incomeMultiplier: 1, expenseMultiplier: 1, duration: 0, color: 'gray' },
    { id: 'recession', name: 'Recession', description: '20% income reduction, 10% expense increase', incomeMultiplier: 0.8, expenseMultiplier: 1.1, duration: 12, color: 'red' },
    { id: 'jobLoss', name: 'Job Loss', description: '60% income reduction for 6 months', incomeMultiplier: 0.4, expenseMultiplier: 1, duration: 6, color: 'orange' },
    { id: 'promotion', name: 'Promotion', description: '25% income increase', incomeMultiplier: 1.25, expenseMultiplier: 1, duration: 0, color: 'green' }
  ];

  const currentScenario = scenarios.find(s => s.id === selectedScenario) || scenarios[0];

  const calculations = useMemo(() => {
    if (!data || !data.transactions || !data.budgets || !data.goals) {
      return {
        monthlyIncome: 0,
        monthlyExpenses: 0,
        netSavings: 0,
        emergencyFund: 0,
        recommendedEmergencyFund: 0,
        scenarioIncome: 0,
        scenarioExpenses: 0,
        scenarioNetSavings: 0,
        goalsProgress: 0
      };
    }

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const monthlyIncome = data.transactions
      .filter(t => t.type === 'income' && 
                   new Date(t.date).getMonth() === currentMonth && 
                   new Date(t.date).getFullYear() === currentYear)
      .reduce((sum, t) => sum + t.amount, 0);

    const monthlyExpenses = data.transactions
      .filter(t => t.type === 'expense' && 
                   new Date(t.date).getMonth() === currentMonth && 
                   new Date(t.date).getFullYear() === currentYear)
      .reduce((sum, t) => sum + t.amount, 0);

    const netSavings = monthlyIncome - monthlyExpenses;
    
    const emergencyFund = (data.accounts || [])
      .filter(a => a.type === 'Checking' || a.type === 'Savings')
      .reduce((sum, a) => sum + (a.balance || 0), 0);

    const recommendedEmergencyFund = monthlyExpenses * 6;

    const scenarioIncome = monthlyIncome * currentScenario.incomeMultiplier;
    const scenarioExpenses = monthlyExpenses * currentScenario.expenseMultiplier;
    const scenarioNetSavings = scenarioIncome - scenarioExpenses;

    const goalsProgress = (data.goals || [])
      .reduce((sum, goal) => sum + (goal.currentAmount / goal.targetAmount), 0) / (data.goals.length || 1);

    return {
      monthlyIncome,
      monthlyExpenses,
      netSavings,
      emergencyFund,
      recommendedEmergencyFund,
      scenarioIncome,
      scenarioExpenses,
      scenarioNetSavings,
      goalsProgress
    };
  }, [data, currentScenario]);


  if (loading || !data) {
    return (
      <PageLayout title="Plan" description="Loading financial plan...">
        <div className="flex items-center justify-center min-h-[24rem]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout 
      title="Plan" 
      description="Comprehensive financial planning with scenario analysis and life events management."
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Annual Income</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.monthlyIncome * 12)}</p>
              </div>
              <BanknotesIcon className="h-8 w-8 text-blue-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm">Annual Expenses</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.monthlyExpenses * 12)}</p>
              </div>
              <ChartBarIcon className="h-8 w-8 text-red-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Net Savings</p>
                <p className="text-2xl font-bold">{formatCurrencyString(calculations.netSavings * 12)}</p>
              </div>
              <ArrowTrendingUpIcon className="h-8 w-8 text-green-200" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">Active Goals</p>
                <p className="text-2xl font-bold">{data.goals?.length || 0}</p>
              </div>
              <AcademicCapIcon className="h-8 w-8 text-purple-200" />
            </div>
          </div>
        </div>

        {/* Scenario Analysis */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Scenario Analysis</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {scenarios.map(scenario => (
              <button
                key={scenario.id}
                onClick={() => setSelectedScenario(scenario.id)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedScenario === scenario.id 
                    ? 'border-primary bg-primary/5' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-left">
                  <h3 className="font-semibold text-gray-900">{scenario.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{scenario.description}</p>
                </div>
              </button>
            ))}
          </div>

          {selectedScenario !== 'none' && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Scenario Impact</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Monthly Income</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrencyString(calculations.scenarioIncome)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {calculations.scenarioIncome < calculations.monthlyIncome ? '-' : '+'}
                    {formatCurrencyString(Math.abs(calculations.scenarioIncome - calculations.monthlyIncome))}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Monthly Expenses</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrencyString(calculations.scenarioExpenses)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {calculations.scenarioExpenses > calculations.monthlyExpenses ? '+' : ''}
                    {formatCurrencyString(Math.abs(calculations.scenarioExpenses - calculations.monthlyExpenses))}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Net Savings</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrencyString(calculations.scenarioNetSavings)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {calculations.scenarioNetSavings < calculations.netSavings ? '-' : '+'}
                    {formatCurrencyString(Math.abs(calculations.scenarioNetSavings - calculations.netSavings))}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Emergency Fund Analysis */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Emergency Fund Analysis</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Current Emergency Fund</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCurrencyString(calculations.emergencyFund)}
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Recommended (6 months)</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCurrencyString(calculations.recommendedEmergencyFund)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    calculations.emergencyFund >= calculations.recommendedEmergencyFund 
                      ? 'bg-green-500' 
                      : calculations.emergencyFund >= calculations.recommendedEmergencyFund * 0.5 
                      ? 'bg-yellow-500' 
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, (calculations.emergencyFund / calculations.recommendedEmergencyFund) * 100)}%` }}
                ></div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              {calculations.emergencyFund >= calculations.recommendedEmergencyFund ? (
                <div className="flex items-center text-green-600">
                  <ShieldCheckIcon className="h-5 w-5 mr-2" />
                  <span className="text-sm font-medium">Well Protected</span>
                </div>
              ) : calculations.emergencyFund >= calculations.recommendedEmergencyFund * 0.5 ? (
                <div className="flex items-center text-yellow-600">
                  <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                  <span className="text-sm font-medium">Needs Improvement</span>
                </div>
              ) : (
                <div className="flex items-center text-red-600">
                  <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                  <span className="text-sm font-medium">At Risk</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Goals Overview */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Goals Overview</h2>
          
          <div className="space-y-4">
            {data.goals?.slice(0, 5).map(goal => (
              <div key={goal.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{goal.name}</h3>
                  <p className="text-sm text-gray-600">
                    Target: {formatCurrencyString(goal.targetAmount)} by {format(new Date(goal.deadline), 'MMM yyyy')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {formatCurrencyString(goal.currentAmount)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {Math.round((goal.currentAmount / goal.targetAmount) * 100)}% complete
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default Plan;
