import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { workerApiBaseUrl } from "../env";
import type { ErrorResponse, JsonObject } from "./api-contract";

type BaseApiErrorOptions = {
  status?: number;
  code?: string;
  details?: JsonObject;
  cause?: unknown;
};

export class BaseApiError extends Error {
  status?: number;
  code?: string;
  details?: JsonObject;
  override cause?: unknown;

  constructor(message: string, options: BaseApiErrorOptions = {}) {
    super(message);
    this.name = "BaseApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export class BaseApi {
  readonly client: AxiosInstance;

  constructor(baseURL = workerApiBaseUrl) {
    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async request<TResponse>(config: AxiosRequestConfig): Promise<TResponse> {
    try {
      const response = await this.client.request<TResponse>(config);
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  get<TResponse>(url: string, config?: AxiosRequestConfig): Promise<TResponse> {
    return this.request<TResponse>({ ...config, method: "GET", url });
  }

  post<TResponse, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: AxiosRequestConfig
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...config, method: "POST", url, data });
  }

  patch<TResponse, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: AxiosRequestConfig
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...config, method: "PATCH", url, data });
  }
}

export const baseApi = new BaseApi();

function normalizeApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (isErrorResponse(payload)) {
      return new BaseApiError(payload.error.message, {
        status: error.response?.status,
        code: payload.error.code,
        details: payload.error.details,
        cause: error
      });
    }

    return new BaseApiError(error.message, {
      status: error.response?.status,
      cause: error
    });
  }

  if (error instanceof Error) {
    return new BaseApiError(error.message, { cause: error });
  }

  return new BaseApiError("Unknown API error", { cause: error });
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return false;
  }

  return typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string";
}
