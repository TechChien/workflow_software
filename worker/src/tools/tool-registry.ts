export type ToolCapability = {
  name: string;
  description: string;
  readOnly: boolean;
};

export const registeredTools: ToolCapability[] = [];
