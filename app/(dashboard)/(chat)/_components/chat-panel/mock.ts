import { Message } from '@/app/(dashboard)/(chat)/_components/chat-panel/chat-conversation/chat-conversation';

export const MOCK_MESSAGES = [
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
        content:
            "For PPAs and revenue recognition, you'll want to:\n\n**Key Audit Procedures:**\n\n1. **Review Contract Terms**: Verify all PPAs are properly documented with clear pricing mechanisms (fixed, indexed, or hybrid)\n2. **Revenue Timing**: Confirm revenue is recognized according to ASC 606 (or IFRS 15) - typically when control transfers, which for energy means when electricity is delivered\n3. **Volume Verification**: Cross-reference billed volumes with actual meter readings and grid operator data\n4. **Price Verification**: Validate pricing against contract terms and market indices (if applicable)\n5. **Deferred Revenue**: Check if any upfront payments or capacity payments are being amortized correctly\n\n**Red Flags to Watch For:**\n- Revenue recognized before delivery\n- Inconsistent treatment of similar contracts\n- Missing or incomplete contract documentation\n- Discrepancies between billed amounts and meter data\n\nWould you like me to help you create a checklist for reviewing their PPA contracts?",
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
        content:
            "Here's a **PPA Audit Checklist**:\n\n```\n□ Contract execution dates and terms\n□ Pricing structure (fixed/variable/hybrid)\n□ Delivery points and transmission arrangements\n□ Force majeure clauses and termination rights\n□ Metering and measurement protocols\n□ Billing and payment terms\n□ Revenue recognition method applied\n□ Volume reconciliation with grid data\n□ Price adjustments and escalations\n□ Related party transactions\n```\n\n**For Renewable Energy Verification:**\n\n1. **REC Tracking**: Verify Renewable Energy Credits (RECs) are properly tracked and retired\n2. **Generation Sources**: Review generation data from renewable facilities (solar, wind, hydro)\n3. **Power Mix Calculations**: Validate the 40% claim by:\n   - Total renewable generation / Total generation\n   - Check if they're counting purchased renewable energy\n   - Verify REC ownership and retirement\n4. **Regulatory Filings**: Cross-reference with EPA eGRID data and state renewable portfolio standard (RPS) reports\n5. **Third-Party Verification**: Check for Green-e or similar certifications\n\n**Documents to Request:**\n- REC purchase and retirement records\n- Generation facility operating reports\n- Grid operator interconnection agreements\n- State RPS compliance filings\n\nShould I help you draft a data request letter for these documents?",
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
        content:
            "This is **very serious** and represents a significant compliance violation:\n\n**Immediate Concerns:**\n\n1. **OSHA Violations**: Failure to maintain accurate OSHA 300 logs can result in fines up to $15,625 per violation (as of 2024)\n2. **Legal Liability**: Underreporting can indicate broader safety culture issues and may expose the company to increased liability\n3. **Regulatory Risk**: Energy companies are subject to additional oversight from agencies like FERC and state public utility commissions\n\n**Recommended Actions:**\n\n1. **Document Everything**: Create a detailed timeline of the incidents with dates, locations, and circumstances\n2. **Interview Personnel**: Speak with affected employees and safety managers (if possible)\n3. **Review Safety Programs**: Assess whether this is systemic or isolated incidents\n4. **Escalate Appropriately**: Depending on severity, this may need to be reported to:\n   - Company's board/audit committee\n   - External legal counsel\n   - Regulatory bodies (if required)\n5. **Assess Financial Impact**: Consider potential fines, legal costs, and insurance implications\n\n**Questions to Investigate:**\n- Why were these incidents not logged?\n- Are there other unreported incidents?\n- Is there a pattern of underreporting?\n- What is the company's safety training and reporting culture?\n\nWould you like help creating a formal finding document for this issue?",
    },
    {
        id: '9',
        role: 'user',
        content:
            'Yes, please. Also, can you help me understand what I should look for when auditing their capital expenditure projects? They have several major infrastructure upgrades in progress.',
    },
    {
        id: '10',
        role: 'assistant',
        content:
            "**Formal Finding Template - Safety Incident Underreporting:**\n\n```\nFINDING: Failure to Maintain Accurate OSHA Injury Logs\n\nSEVERITY: High\n\nDESCRIPTION:\nDuring Q3 2024, three workplace injuries occurred that were not \nproperly recorded in the company's OSHA 300 log, violating 29 CFR \n1904 requirements.\n\nEVIDENCE:\n- Incident reports dated [dates]\n- Medical records\n- Employee interviews\n- Missing entries in OSHA 300 log\n\nRISK:\n- Regulatory fines and penalties\n- Increased legal liability\n- Potential criminal charges for willful violations\n- Reputational damage\n\nRECOMMENDATION:\n1. Immediately correct OSHA 300 log\n2. Conduct comprehensive safety audit\n3. Implement improved reporting procedures\n4. Provide additional safety training\n```\n\n**Capital Expenditure Audit Focus Areas:**\n\n1. **Project Authorization**: Verify board/management approval and budget authorization\n2. **Cost Overruns**: Compare actual costs to budgeted amounts and investigate variances\n3. **Timeline Delays**: Assess impact of delays on project economics and regulatory compliance\n4. **Asset Classification**: Ensure proper capitalization vs. expense treatment\n5. **Depreciation**: Verify correct useful lives and depreciation methods\n6. **Change Orders**: Review for proper approval and documentation\n7. **Related Party Transactions**: Check for conflicts of interest with contractors/vendors\n8. **Regulatory Approval**: Confirm all required permits and approvals are in place\n\n**Key Documents:**\n- Project charters and business cases\n- Budget vs. actual reports\n- Contractor agreements and invoices\n- Regulatory permits\n- Asset capitalization worksheets\n\nWould you like a detailed CAPEX audit program?",
    },
] satisfies Message[];
