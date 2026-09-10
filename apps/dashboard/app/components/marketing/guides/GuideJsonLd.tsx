export function GuideJsonLd({ data }: { data: ReadonlyArray<Record<string, unknown>> }) {
  return (
    <>
      {data.map((payload, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
        />
      ))}
    </>
  );
}
