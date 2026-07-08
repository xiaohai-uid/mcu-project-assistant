export const openApiSpec: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: 'MCU Project Assistant API',
    version: '0.1.0',
    description:
      'REST API for the MCU Project Assistant — a platform that uses AI to generate microcontroller project plans, component recommendations, code, and wiring schematics from natural language descriptions.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created', content: { 'application/json': { schema: { type: 'object', properties: { userId: { type: 'string' }, email: { type: 'string' } } } } } },
          '400': { description: 'Invalid input' },
          '409': { description: 'Email already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate a user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    userId: { type: 'string' },
                    email: { type: 'string' },
                    membership: { type: 'string', enum: ['free', 'premium', 'hasKey'] },
                  },
                },
              },
            },
          },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/profile': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'User profile' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List all projects for the current user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Project list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Project' },
                },
              },
            },
          },
        },
      },
    },
    '/api/projects/start': {
      post: {
        tags: ['Projects'],
        summary: 'Start a new project from a description',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'description'],
                properties: {
                  userId: { type: 'string' },
                  description: { type: 'string' },
                  experienceLevel: { type: 'string', enum: ['beginner', 'professional'] },
                  platform: { type: 'string', enum: ['arduino', 'esp32', 'stm32'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Project started', content: { 'application/json': { schema: { type: 'object', properties: { designDraftId: { type: 'string' } } } } } },
          '403': { description: 'Platform not allowed' },
          '429': { description: 'Daily quota exceeded' },
        },
      },
    },
    '/api/projects/{id}': {
      get: {
        tags: ['Projects'],
        summary: 'Get project details',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Project details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } } },
          '404': { description: 'Project not found' },
        },
      },
    },
    '/api/projects/{id}/export': {
      get: {
        tags: ['Projects'],
        summary: 'Export project in the requested format',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['ino', 'svg', 'zip'] } },
        ],
        responses: {
          '200': { description: 'File download' },
          '404': { description: 'Project not found' },
        },
      },
    },
    '/api/projects/{id}/snapshots': {
      get: {
        tags: ['Snapshots'],
        summary: 'List version snapshots for a project',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Snapshot list' },
        },
      },
    },
    '/api/projects/snapshot': {
      post: {
        tags: ['Snapshots'],
        summary: 'Create a new version snapshot',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId'],
                properties: { projectId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Snapshot created' },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          '200': { description: 'Service is healthy' },
        },
      },
    },
    '/api/keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys for the current user',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'API key list' } },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create or update an API key',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider', 'key'],
                properties: {
                  provider: { type: 'string', enum: ['openai', 'deepseek'] },
                  key: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Key saved' } },
      },
    },
    '/api/billing/balance': {
      get: {
        tags: ['Billing'],
        summary: 'Get current balance and usage',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Balance info' } },
      },
    },
    '/api/billing/topup': {
      post: {
        tags: ['Billing'],
        summary: 'Top up account balance',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: { amount: { type: 'number' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Top-up processed' } },
      },
    },
    '/api/membership': {
      get: {
        tags: ['Membership'],
        summary: 'Get membership details',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Membership details' } },
      },
    },
    '/api/quota': {
      get: {
        tags: ['Quota'],
        summary: 'Get daily quota status',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Quota status' } },
      },
    },
    '/api/templates': {
      get: {
        tags: ['Templates'],
        summary: 'List project templates',
        responses: { '200': { description: 'Template list' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          raw_description: { type: 'string' },
          status: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}

export default openApiSpec
