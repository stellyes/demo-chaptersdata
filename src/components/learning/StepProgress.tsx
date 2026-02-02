'use client';

import { CheckCircle, Database, MessageSquare, Search, GitBranch, FileText, Loader2 } from 'lucide-react';

export interface LearningStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

interface StepProgressProps {
  steps: LearningStep[];
}

const stepIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  data_review: Database,
  question_gen: MessageSquare,
  web_research: Search,
  correlation: GitBranch,
  digest_gen: FileText,
};

export function StepProgress({ steps }: StepProgressProps) {
  return (
    <div className="w-full py-4">
      <div className="flex items-start justify-between relative">
        {/* Connection line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-[var(--border)]" style={{ marginLeft: '2.5rem', marginRight: '2.5rem' }} />

        {/* Progress line overlay */}
        <div
          className="absolute top-5 left-0 h-0.5 bg-[var(--accent)] transition-all duration-500"
          style={{
            marginLeft: '2.5rem',
            width: `calc(${getProgressWidth(steps)}% - 2.5rem)`,
          }}
        />

        {steps.map((step, index) => {
          const Icon = stepIcons[step.id] || FileText;
          const isActive = step.status === 'in_progress';
          const isCompleted = step.status === 'completed';
          const isSkipped = step.status === 'skipped';

          return (
            <div key={step.id} className="flex flex-col items-center relative z-10 flex-1">
              {/* Step circle */}
              <div
                className={`
                  flex items-center justify-center rounded-full transition-all duration-300
                  ${isActive
                    ? 'w-14 h-14 bg-[var(--accent)] text-white shadow-lg ring-4 ring-[var(--accent)]/20'
                    : isCompleted || isSkipped
                      ? 'w-10 h-10 bg-[var(--accent)] text-white'
                      : 'w-10 h-10 bg-[var(--paper)] border-2 border-[var(--border)] text-[var(--muted)]'
                  }
                `}
              >
                {isCompleted ? (
                  <CheckCircle className="w-5 h-5" />
                ) : isSkipped ? (
                  <span className="text-xs font-medium">Skip</span>
                ) : isActive ? (
                  <div className="relative">
                    <Icon className="w-6 h-6" />
                    <Loader2 className="w-4 h-4 absolute -bottom-1 -right-1 animate-spin text-white" />
                  </div>
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>

              {/* Step label */}
              <div className={`mt-3 text-center ${isActive ? 'min-h-[3rem]' : 'min-h-[2rem]'}`}>
                <p className={`
                  text-xs font-medium transition-all
                  ${isActive
                    ? 'text-[var(--accent)] text-sm'
                    : isCompleted || isSkipped
                      ? 'text-[var(--ink)]'
                      : 'text-[var(--muted)]'
                  }
                `}>
                  {step.label}
                </p>
                {isActive && (
                  <p className="text-xs text-[var(--accent)] mt-0.5 animate-pulse">
                    In progress
                  </p>
                )}
                {isSkipped && (
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    Skipped
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getProgressWidth(steps: LearningStep[]): number {
  const completedCount = steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const activeStep = steps.find(s => s.status === 'in_progress');

  if (completedCount === steps.length) {
    return 100;
  }

  // Calculate progress based on completed steps + half of active step
  const stepWidth = 100 / (steps.length - 1);
  let progress = completedCount * stepWidth;

  if (activeStep) {
    progress += stepWidth * 0.5; // Add half step for active
  }

  return Math.min(progress, 100);
}

// Helper to convert phase string to step data
export function phaseToSteps(
  currentPhase: string | null,
  phasesCompleted: {
    dataReviewDone: boolean;
    questionGenDone: boolean;
    webResearchDone: boolean;
    correlationDone: boolean;
    digestGenDone: boolean;
  },
  skipWebResearch: boolean = false
): LearningStep[] {
  const phaseOrder = ['data_review', 'question_gen', 'web_research', 'correlation', 'digest_gen'];
  const phaseLabels: Record<string, string> = {
    data_review: 'Data Review',
    question_gen: 'Generate Questions',
    web_research: 'Web Research',
    correlation: 'Find Correlations',
    digest_gen: 'Create Digest',
  };

  const phaseKeys: Record<string, keyof typeof phasesCompleted> = {
    data_review: 'dataReviewDone',
    question_gen: 'questionGenDone',
    web_research: 'webResearchDone',
    correlation: 'correlationDone',
    digest_gen: 'digestGenDone',
  };

  return phaseOrder.map(phase => {
    const isCompleted = phasesCompleted[phaseKeys[phase]];
    const isActive = currentPhase === phase;
    const isWebResearchSkipped = phase === 'web_research' && skipWebResearch && !isActive;

    let status: LearningStep['status'] = 'pending';
    if (isCompleted) {
      status = isWebResearchSkipped ? 'skipped' : 'completed';
    } else if (isActive) {
      status = 'in_progress';
    } else if (phase === 'web_research' && skipWebResearch) {
      // Check if we've passed this phase
      const currentIndex = phaseOrder.indexOf(currentPhase || '');
      const webResearchIndex = phaseOrder.indexOf('web_research');
      if (currentIndex > webResearchIndex || phasesCompleted.webResearchDone) {
        status = 'skipped';
      }
    }

    return {
      id: phase,
      label: phaseLabels[phase],
      status,
    };
  });
}
