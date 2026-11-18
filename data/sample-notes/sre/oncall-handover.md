# On-call handover template

Fill in before the handover call, five minutes at most:

1. **Open incidents:** link, severity, who owns the next step.
2. **Alerts that fired and were silenced:** why, and when the silence expires.
3. **Error budget:** remaining percentage per SLO; anything below 25 % means no risky deploys this week.
4. **Planned changes:** migrations, certificate renewals, provider maintenance windows.
5. **One thing that surprised me:** the alert that was noise, the runbook step that was wrong.

The person taking over reads it aloud and asks one question per item they don't understand.
