export type AccountingItem = { label: string; value: string; definition: string; primary?: boolean };

export function AccountingCards({ items }: { items: AccountingItem[] }) {
  return <section className="accounting-grid" aria-label="Protection accounting">
    {items.map((item) => <article className={item.primary ? "accounting-card primary" : "accounting-card"} key={item.label}>
      <small>{item.label}</small><strong>{item.value}</strong><p>{item.definition}</p>
    </article>)}
  </section>;
}
