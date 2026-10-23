import { PLAN_CARDS, type PlanCard } from './upgrade'
import styles from './PlanCards.module.css'

export type PlanButton = {
  label: string
  bright?: boolean // the plan being suggested: the one bright button
  disabled?: boolean
  onClick?: () => void
}

// One card per plan: name, price, its button, then what it gives. Where it is
// shown decides what each button says and does.
function PlanCards({ button, className }: { button: (plan: PlanCard) => PlanButton; className?: string }) {
  return (
    <div className={`${styles.plans} ${className ?? ''}`}>
      {PLAN_CARDS.map((plan) => {
        const action = button(plan)
        return (
          <div key={plan.id} className={styles.plan}>
            <h3 className={styles.planName}>{plan.name}</h3>
            <p className={styles.planPrice}>
              {plan.price}
              <span className={styles.planPer}>/month</span>
            </p>
            <button
              type="button"
              className={`${styles.planButton} ${action.bright ? styles.planButtonBright : ''}`}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
            <p className={styles.planLead}>{plan.lead}</p>
            <p className={styles.planHeadline}>{plan.headline}</p>
            <p className={styles.planSub}>{plan.sub}</p>
            <ul className={styles.planPoints}>
              {plan.points.map((point) => (
                <li key={point}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M2.5 6.5l2.5 2.5 4.5-6" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
            {plan.note && <p className={styles.planNote}>{plan.note}</p>}
          </div>
        )
      })}
    </div>
  )
}

export default PlanCards
