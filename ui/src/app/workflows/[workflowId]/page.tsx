export default async function WorkflowPage({
  params
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;

  return (
    <main className="detail-page">
      <h1>Workflow {workflowId}</h1>
      <p>Draft editing, publish history, and YAML import/export will live here.</p>
    </main>
  );
}
