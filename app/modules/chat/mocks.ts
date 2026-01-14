import type { Artifact, Message } from '@/app/modules/chat/types';

export const MOCK_MESSAGES: Message[] = [
    {
        id: '1',
        role: 'user',
        content:
            "I need to conduct a comprehensive audit of GreenEnergy Corp's operations. What are the key areas I should focus on?",
    },
    {
        id: '2',
        role: 'assistant',
        content:
            'For an energy company audit, you should focus on several critical areas:\n\n1. **Financial Compliance**: Review revenue recognition, power purchase agreements (PPAs), and regulatory compliance costs\n2. **Operational Efficiency**: Analyze generation capacity, transmission losses, and maintenance schedules\n3. **Environmental Compliance**: Verify emissions reporting, renewable energy credits (RECs), and environmental permits\n4. **Safety & Risk Management**: Review safety protocols, incident reports, and insurance coverage\n5. **Regulatory Compliance**: Check adherence to FERC, NERC, and state-level regulations\n6. **Asset Management**: Audit infrastructure investments, depreciation schedules, and capital expenditures\n\nWhich area would you like to start with?',
    },
    {
        id: '3',
        role: 'user',
        content:
            "Let's start with financial compliance. I've noticed discrepancies in their revenue recognition for long-term power purchase agreements. How should I approach this?",
    },
    {
        id: '4',
        role: 'assistant',
        content: `I've prepared a comprehensive analysis document for the PPA audit approach.

:::artifact{identifier="ppa-audit-guide" type="text/markdown" title="PPA Revenue Recognition Audit Guide.md"}
\`\`\`markdown
# PPA Revenue Recognition Audit Guide

## Executive Summary

This guide outlines the systematic approach for auditing Power Purchase Agreement (PPA) revenue recognition at GreenEnergy Corp, focusing on ASC 606 compliance and contractual accuracy.

## Key Audit Procedures

### 1. Contract Terms Review
- Verify all PPAs are properly documented
- Confirm pricing mechanisms (fixed, indexed, or hybrid)
- Review delivery point specifications
- Check force majeure and termination clauses

### 2. Revenue Timing Verification
- Confirm revenue recognition follows ASC 606 (or IFRS 15)
- Verify control transfer occurs at electricity delivery
- Review performance obligation satisfaction timing

### 3. Volume Verification
- Cross-reference billed volumes with meter readings
- Reconcile with grid operator data (CAISO, PJM, etc.)
- Investigate any discrepancies > 2%

### 4. Price Verification
- Validate pricing against contract terms
- Check market index references (if applicable)
- Review escalation calculations

### 5. Deferred Revenue Analysis
- Verify upfront payments are properly amortized
- Check capacity payment treatment
- Review contract modification accounting

## Red Flags to Watch For

| Red Flag | Risk Level | Action Required |
|----------|------------|-----------------|
| Revenue recognized before delivery | High | Immediate investigation |
| Inconsistent contract treatment | Medium | Standardization review |
| Missing documentation | High | Document reconstruction |
| Meter/billing discrepancies | Medium | Reconciliation audit |

## Recommended Testing Sample

- 100% of contracts > $10M annual value
- 50% of contracts $1M-$10M
- 25% random sample of remaining contracts

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Planning | 2 weeks | Audit program |
| Fieldwork | 6 weeks | Working papers |
| Review | 2 weeks | Draft findings |
| Reporting | 1 week | Final report |
\`\`\`
:::

This document provides the framework for your audit. Would you like me to help you create the specific test procedures for any of these areas?`,
    },
    {
        id: '5',
        role: 'user',
        content:
            "Yes, that would be helpful. Also, I'm concerned about their environmental compliance reporting. They claim to have 40% renewable energy mix, but I need to verify this.",
    },
    {
        id: '6',
        role: 'assistant',
        content: `I've created a comprehensive verification checklist for the renewable energy claims.

:::artifact{identifier="renewable-verification" type="text/markdown" title="Renewable Energy Verification Checklist.md"}
\`\`\`markdown
# Renewable Energy Mix Verification Checklist

## Claimed Position: 40% Renewable Energy Mix

### Data Sources to Verify

#### Primary Sources
- [ ] Generation facility operating reports
- [ ] REC purchase and retirement records
- [ ] Grid operator interconnection agreements
- [ ] State RPS compliance filings

#### Secondary Validation
- [ ] EPA eGRID data cross-reference
- [ ] Green-e certification status
- [ ] Third-party audit reports

### Calculation Methodology

**Formula:**
\`\`\`
Renewable % = (Renewable Generation + Purchased RECs) / Total Generation × 100
\`\`\`

**Key Questions:**
1. Are they counting self-generated renewable energy?
2. Are purchased RECs being double-counted?
3. Is the denominator consistent (MWh generated vs. MWh sold)?

### Verification Steps

| Step | Action | Evidence Required |
|------|--------|-------------------|
| 1 | Request generation data by source | Monthly operating reports |
| 2 | Verify REC ownership | WREGIS/M-RETS statements |
| 3 | Confirm REC retirement | Retirement certificates |
| 4 | Cross-check with regulators | State RPS filings |
| 5 | Validate calculations | Independent recalculation |

### Common Issues Found in Prior Audits

1. **Double-counting RECs** - Same REC claimed for RPS compliance and marketing
2. **Timing mismatches** - RECs from different vintage years
3. **Ownership gaps** - RECs sold but still counted in mix
4. **Calculation errors** - Inconsistent measurement units

### Regulatory References

- EPA Clean Energy Standards
- State Renewable Portfolio Standards
- FTC Green Guides (16 CFR Part 260)
\`\`\`
:::

This checklist will help you systematically verify their 40% renewable claim. Should I also prepare the data request letter for these documents?`,
    },
    {
        id: '7',
        role: 'user',
        content:
            "That's great. Now, I've identified some safety incidents that weren't properly reported. There were 3 workplace injuries in Q3 that don't appear in their OSHA logs. How serious is this?",
    },
    {
        id: '8',
        role: 'assistant',
        content: `This is a **significant compliance violation**. I've prepared a formal finding document for this issue.

:::artifact{identifier="safety-finding" type="text/markdown" title="Safety Incident Underreporting Finding.md"}
\`\`\`markdown
# AUDIT FINDING: Safety Incident Underreporting

## Finding Classification

| Attribute | Value |
|-----------|-------|
| **Finding ID** | GEC-2024-SF-001 |
| **Severity** | HIGH |
| **Category** | Regulatory Compliance |
| **Regulation** | 29 CFR 1904 (OSHA Recordkeeping) |

## Description

During Q3 2024, three (3) workplace injuries occurred that were not properly recorded in the company's OSHA Form 300 log, constituting a violation of federal recordkeeping requirements.

## Evidence Summary

- Incident reports dated [dates to be confirmed]
- Medical treatment records indicating recordable injuries
- Employee interview statements
- Gap analysis of OSHA 300 log entries

## Risk Assessment

### Regulatory Risk
- **OSHA Penalties**: Up to $15,625 per violation (2024 rates)
- **Willful violation**: Up to $156,259 per violation
- **Potential for increased OSHA inspections**

### Legal Risk
- Increased liability exposure in workers' compensation claims
- Potential whistleblower complaints
- Discovery implications in litigation

### Operational Risk
- Indicates broader safety culture issues
- May affect insurance premiums and coverage
- Reputational damage if publicized

## Root Cause Analysis Required

1. Why were these incidents not logged?
2. Is there a pattern of underreporting?
3. Was this a training gap or intentional omission?
4. Are supervisors properly trained on recordkeeping?

## Recommended Actions

### Immediate (0-30 days)
1. Correct OSHA 300 log with all identified incidents
2. Notify legal counsel of findings
3. Preserve all related documentation

### Short-term (30-90 days)
1. Conduct comprehensive safety records audit
2. Implement improved incident reporting procedures
3. Provide refresher training to all supervisors

### Long-term (90+ days)
1. Engage third-party safety audit
2. Consider voluntary OSHA disclosure
3. Strengthen safety management system

## Escalation Requirements

This finding should be reported to:
- [ ] Audit Committee (within 5 business days)
- [ ] General Counsel (immediate)
- [ ] Chief Safety Officer (immediate)
- [ ] External auditors (as required)
\`\`\`
:::

This is a serious matter that requires immediate attention. Would you like me to help draft the communication to the audit committee?`,
    },
];

export const MOCK_ARTIFACTS: Artifact[] = [
    {
        id: 'ppa-audit-guide_4',
        identifier: 'ppa-audit-guide',
        title: 'PPA Revenue Recognition Audit Guide.md',
        type: 'text/markdown',
        messageId: '4',
        content: `# PPA Revenue Recognition Audit Guide

## Executive Summary

This guide outlines the systematic approach for auditing Power Purchase Agreement (PPA) revenue recognition at GreenEnergy Corp, focusing on ASC 606 compliance and contractual accuracy.

## Key Audit Procedures

### 1. Contract Terms Review
- Verify all PPAs are properly documented
- Confirm pricing mechanisms (fixed, indexed, or hybrid)
- Review delivery point specifications
- Check force majeure and termination clauses

### 2. Revenue Timing Verification
- Confirm revenue recognition follows ASC 606 (or IFRS 15)
- Verify control transfer occurs at electricity delivery
- Review performance obligation satisfaction timing

### 3. Volume Verification
- Cross-reference billed volumes with meter readings
- Reconcile with grid operator data (CAISO, PJM, etc.)
- Investigate any discrepancies > 2%

### 4. Price Verification
- Validate pricing against contract terms
- Check market index references (if applicable)
- Review escalation calculations

### 5. Deferred Revenue Analysis
- Verify upfront payments are properly amortized
- Check capacity payment treatment
- Review contract modification accounting

## Red Flags to Watch For

| Red Flag | Risk Level | Action Required |
|----------|------------|-----------------|
| Revenue recognized before delivery | High | Immediate investigation |
| Inconsistent contract treatment | Medium | Standardization review |
| Missing documentation | High | Document reconstruction |
| Meter/billing discrepancies | Medium | Reconciliation audit |

## Recommended Testing Sample

- 100% of contracts > $10M annual value
- 50% of contracts $1M-$10M
- 25% random sample of remaining contracts

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Planning | 2 weeks | Audit program |
| Fieldwork | 6 weeks | Working papers |
| Review | 2 weeks | Draft findings |
| Reporting | 1 week | Final report |`,
    },
    {
        id: 'renewable-verification_6',
        identifier: 'renewable-verification',
        title: 'Renewable Energy Verification Checklist.md',
        type: 'text/markdown',
        messageId: '6',
        content: `# Renewable Energy Mix Verification Checklist

## Claimed Position: 40% Renewable Energy Mix

### Data Sources to Verify

#### Primary Sources
- [ ] Generation facility operating reports
- [ ] REC purchase and retirement records
- [ ] Grid operator interconnection agreements
- [ ] State RPS compliance filings

#### Secondary Validation
- [ ] EPA eGRID data cross-reference
- [ ] Green-e certification status
- [ ] Third-party audit reports

### Calculation Methodology

**Formula:**
\`\`\`
Renewable % = (Renewable Generation + Purchased RECs) / Total Generation × 100
\`\`\`

**Key Questions:**
1. Are they counting self-generated renewable energy?
2. Are purchased RECs being double-counted?
3. Is the denominator consistent (MWh generated vs. MWh sold)?

### Verification Steps

| Step | Action | Evidence Required |
|------|--------|-------------------|
| 1 | Request generation data by source | Monthly operating reports |
| 2 | Verify REC ownership | WREGIS/M-RETS statements |
| 3 | Confirm REC retirement | Retirement certificates |
| 4 | Cross-check with regulators | State RPS filings |
| 5 | Validate calculations | Independent recalculation |

### Common Issues Found in Prior Audits

1. **Double-counting RECs** - Same REC claimed for RPS compliance and marketing
2. **Timing mismatches** - RECs from different vintage years
3. **Ownership gaps** - RECs sold but still counted in mix
4. **Calculation errors** - Inconsistent measurement units

### Regulatory References

- EPA Clean Energy Standards
- State Renewable Portfolio Standards
- FTC Green Guides (16 CFR Part 260)`,
    },
    {
        id: 'safety-finding_8',
        identifier: 'safety-finding',
        title: 'Safety Incident Underreporting Finding.md',
        type: 'text/markdown',
        messageId: '8',
        content: `# AUDIT FINDING: Safety Incident Underreporting

## Finding Classification

| Attribute | Value |
|-----------|-------|
| **Finding ID** | GEC-2024-SF-001 |
| **Severity** | HIGH |
| **Category** | Regulatory Compliance |
| **Regulation** | 29 CFR 1904 (OSHA Recordkeeping) |

## Description

During Q3 2024, three (3) workplace injuries occurred that were not properly recorded in the company's OSHA Form 300 log, constituting a violation of federal recordkeeping requirements.

## Evidence Summary

- Incident reports dated [dates to be confirmed]
- Medical treatment records indicating recordable injuries
- Employee interview statements
- Gap analysis of OSHA 300 log entries

## Risk Assessment

### Regulatory Risk
- **OSHA Penalties**: Up to $15,625 per violation (2024 rates)
- **Willful violation**: Up to $156,259 per violation
- **Potential for increased OSHA inspections**

### Legal Risk
- Increased liability exposure in workers' compensation claims
- Potential whistleblower complaints
- Discovery implications in litigation

### Operational Risk
- Indicates broader safety culture issues
- May affect insurance premiums and coverage
- Reputational damage if publicized

## Root Cause Analysis Required

1. Why were these incidents not logged?
2. Is there a pattern of underreporting?
3. Was this a training gap or intentional omission?
4. Are supervisors properly trained on recordkeeping?

## Recommended Actions

### Immediate (0-30 days)
1. Correct OSHA 300 log with all identified incidents
2. Notify legal counsel of findings
3. Preserve all related documentation

### Short-term (30-90 days)
1. Conduct comprehensive safety records audit
2. Implement improved incident reporting procedures
3. Provide refresher training to all supervisors

### Long-term (90+ days)
1. Engage third-party safety audit
2. Consider voluntary OSHA disclosure
3. Strengthen safety management system

## Escalation Requirements

This finding should be reported to:
- [ ] Audit Committee (within 5 business days)
- [ ] General Counsel (immediate)
- [ ] Chief Safety Officer (immediate)
- [ ] External auditors (as required)`,
    },
];
