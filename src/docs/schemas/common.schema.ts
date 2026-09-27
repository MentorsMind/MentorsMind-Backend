/**
 * Reusable OpenAPI 3.0 schema definitions.
 * Referenced via $ref in JSDoc annotations.
 */

export const commonSchemas = {
  ApiResponse: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['success', 'error', 'fail'],
        example: 'success',
      },
      message: { type: 'string', example: 'Operation successful' },
      data: { type: 'object', nullable: true },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },

  ErrorResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['error', 'fail'], example: 'error' },
      message: { type: 'string', example: 'An error occurred' },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },

  PaginationMeta: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 10 },
      total: { type: 'integer', example: 100 },
      totalPages: { type: 'integer', example: 10 },
    },
  },

  UUIDParam: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    example: '123e4567-e89b-12d3-a456-426614174000',
  },

  PaginationQuery: [
    {
      name: 'page',
      in: 'query',
      schema: { type: 'integer', default: 1, minimum: 1 },
    },
    {
      name: 'limit',
      in: 'query',
      schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
    },
    {
      name: 'sortOrder',
      in: 'query',
      schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    },
  ],
};

export const authSchemas = {
  RegisterRequest: {
    type: 'object',
    required: ['email', 'password', 'firstName', 'lastName'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', minLength: 8, example: 'SecurePass1' },
      firstName: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Jane',
      },
      lastName: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Doe',
      },
      role: { type: 'string', enum: ['mentee', 'mentor'], default: 'mentee' },
    },
  },

  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', example: 'SecurePass1' },
    },
  },

  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: {
        type: 'string',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
      refreshToken: {
        type: 'string',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
      expiresIn: { type: 'integer', example: 3600 },
    },
  },

  RefreshTokenRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: {
        type: 'string',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  },

  ForgotPasswordRequest: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
    },
  },

  ResetPasswordRequest: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', example: 'reset-token-abc123' },
      password: { type: 'string', minLength: 8, example: 'NewSecurePass1' },
    },
  },

  ChangePasswordRequest: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', example: 'OldPass1' },
      newPassword: { type: 'string', minLength: 8, example: 'NewSecurePass1' },
    },
  },
};

export const userSchemas = {
  User: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: '123e4567-e89b-12d3-a456-426614174000',
      },
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      firstName: { type: 'string', example: 'Jane' },
      lastName: { type: 'string', example: 'Doe' },
      role: { type: 'string', enum: ['mentee', 'mentor', 'admin'] },
      bio: {
        type: 'string',
        nullable: true,
        example: 'Experienced software engineer',
      },
      avatarUrl: { type: 'string', format: 'uri', nullable: true },
      isActive: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  PublicUser: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      firstName: { type: 'string', example: 'Jane' },
      lastName: { type: 'string', example: 'Doe' },
      role: { type: 'string', enum: ['mentee', 'mentor'] },
      bio: { type: 'string', nullable: true },
      avatarUrl: { type: 'string', format: 'uri', nullable: true },
    },
  },

  UpdateUserRequest: {
    type: 'object',
    properties: {
      firstName: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Jane',
      },
      lastName: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Doe',
      },
      bio: {
        type: 'string',
        maxLength: 2000,
        example: 'Experienced software engineer',
      },
      avatarUrl: {
        type: 'string',
        format: 'uri',
        example: 'https://example.com/avatar.jpg',
      },
    },
  },

  AvatarUploadRequest: {
    type: 'object',
    required: ['avatarBase64'],
    properties: {
      avatarBase64: {
        type: 'string',
        example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB...',
        description: 'Base64-encoded image (JPEG, PNG, WebP, or GIF). Max 5MB.',
      },
    },
  },
};

export const mentorSchemas = {
  MentorProfile: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      headline: {
        type: 'string',
        example: 'Senior Software Engineer at FAANG',
      },
      bio: { type: 'string', example: '10+ years building scalable systems' },
      skills: {
        type: 'array',
        items: { type: 'string' },
        example: ['TypeScript', 'Node.js', 'AWS'],
      },
      hourlyRate: { type: 'number', example: 150 },
      currency: { type: 'string', example: 'USD' },
      timezone: { type: 'string', example: 'America/New_York' },
      linkedinUrl: { type: 'string', format: 'uri', nullable: true },
      githubUrl: { type: 'string', format: 'uri', nullable: true },
      websiteUrl: { type: 'string', format: 'uri', nullable: true },
    },
  },

  UpdateMentorProfileRequest: {
    type: 'object',
    properties: {
      headline: {
        type: 'string',
        maxLength: 200,
        example: 'Senior Software Engineer',
      },
      bio: { type: 'string', maxLength: 2000 },
      skills: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      hourlyRate: { type: 'number', minimum: 0, maximum: 10000, example: 150 },
      currency: { type: 'string', minLength: 3, maxLength: 3, example: 'USD' },
      timezone: { type: 'string', example: 'America/New_York' },
      linkedinUrl: { type: 'string', format: 'uri' },
      githubUrl: { type: 'string', format: 'uri' },
      websiteUrl: { type: 'string', format: 'uri' },
    },
  },

  Session: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      mentorId: { type: 'string', format: 'uuid' },
      menteeId: { type: 'string', format: 'uuid' },
      scheduledAt: { type: 'string', format: 'date-time' },
      durationMinutes: { type: 'integer', example: 60 },
      topic: { type: 'string', example: 'System Design Interview Prep' },
      notes: { type: 'string', nullable: true },
      status: {
        type: 'string',
        enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  CreateSessionRequest: {
    type: 'object',
    required: ['mentorId', 'scheduledAt', 'durationMinutes', 'topic'],
    properties: {
      mentorId: {
        type: 'string',
        format: 'uuid',
        example: '123e4567-e89b-12d3-a456-426614174000',
      },
      scheduledAt: {
        type: 'string',
        format: 'date-time',
        example: '2026-04-01T14:00:00Z',
      },
      durationMinutes: {
        type: 'integer',
        minimum: 15,
        maximum: 240,
        example: 60,
      },
      topic: { type: 'string', example: 'System Design Interview Prep' },
      notes: { type: 'string', example: 'Focus on distributed systems' },
    },
  },
};

export const walletSchemas = {
  WalletInfo: {
    type: 'object',
    properties: {
      stellarAddress: { type: 'string', example: 'GABC...XYZ' },
      balances: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            assetCode: { type: 'string', example: 'XLM' },
            balance: { type: 'string', example: '100.0000000' },
          },
        },
      },
    },
  },

  WalletBalanceResponse: {
    type: 'object',
    properties: {
      asset_code: { type: 'string', example: 'XLM' },
      balance: { type: 'string', example: '100.0000000' },
      stellar_public_key: { type: 'string', example: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFG' },
    },
  },

  LinkWalletRequest: {
    type: 'object',
    required: ['stellarAddress'],
    properties: {
      stellarAddress: {
        type: 'string',
        example: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFG',
        description: 'Stellar public key (G-address, 56 characters)',
      },
    },
  },

  VerifyTransactionRequest: {
    type: 'object',
    required: ['transactionHash', 'expectedAmount'],
    properties: {
      transactionHash: {
        type: 'string',
        minLength: 64,
        maxLength: 64,
        example: 'abc123...def456',
      },
      expectedAmount: { type: 'string', example: '50.0000000' },
      assetCode: { type: 'string', example: 'XLM' },
    },
  },
};

export const adminSchemas = {
  AdminStats: {
    type: 'object',
    properties: {
      totalUsers: { type: 'integer', example: 1500 },
      totalMentors: { type: 'integer', example: 200 },
      totalSessions: { type: 'integer', example: 5000 },
      totalTransactions: { type: 'integer', example: 3000 },
      activeDisputes: { type: 'integer', example: 5 },
    },
  },

  UpdateUserStatusRequest: {
    type: 'object',
    required: ['isActive'],
    properties: {
      isActive: { type: 'boolean', example: true },
    },
  },

  ResolveDisputeRequest: {
    type: 'object',
    required: ['status', 'notes'],
    properties: {
      status: { type: 'string', enum: ['resolved', 'dismissed'] },
      notes: { type: 'string', example: 'Refund issued to mentee' },
    },
  },

  UpdateConfigRequest: {
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', example: 'platform.feePercentage' },
      value: { description: 'Configuration value (any type)' },
    },
  },
};
