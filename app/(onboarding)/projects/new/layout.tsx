import { ProjectCreationWizardProvider } from './_providers/project-creation-wizard-provider';

export default function NewProjectLayout({ children }: { children: React.ReactNode }) {
    return <ProjectCreationWizardProvider>{children}</ProjectCreationWizardProvider>;
}
