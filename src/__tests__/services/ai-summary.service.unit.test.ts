import { AISummaryService, SessionSummary, ActionItem } from '../services/ai-summary.service';

// Mock axios to avoid actual API calls
jest.mock('axios');
import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AISummaryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('_generateWithOpenAI', () => {
    it('should generate summary using OpenAI API', async () => {
      const mockResponse = {
        data: {
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4-turbo-preview',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  keyTopics: ['JavaScript', 'React', 'Testing'],
                  actionItems: [
                    { description: 'Complete React tutorial', assigned_to: 'mentee', due_date: '2024-01-01', completed: false },
                  ],
                  learningOutcomes: ['Understanding React components', 'State management basics'],
                  nextSteps: ['Build a small React project', 'Learn Redux'],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await AISummaryService._generateWithOpenAI(
        'This is a test transcript about JavaScript and React',
        'JavaScript Session',
      );

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('model');
      expect(result.summary.keyTopics).toContain('JavaScript');
      expect(result.tokensUsed).toBe(150);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          model: 'gpt-4-turbo-preview',
          response_format: { type: 'json_object' },
        }),
        expect.any(Object),
      );
    });

    it('should throw error when OPENAI_API_KEY is not configured', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await expect(
        AISummaryService._generateWithOpenAI('test transcript'),
      ).rejects.toThrow('OPENAI_API_KEY is not configured');

      process.env.OPENAI_API_KEY = originalKey;
    });

    it('should handle API errors gracefully', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      mockedAxios.post.mockRejectedValue(new Error('API Error'));

      await expect(
        AISummaryService._generateWithOpenAI('test transcript'),
      ).rejects.toThrow();
    });
  });

  describe('_generateWithAnthropic', () => {
    it('should generate summary using Anthropic API', async () => {
      const mockResponse = {
        data: {
          id: 'test-id',
          type: 'message',
          model: 'claude-3-opus-20240229',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                keyTopics: ['Python', 'Django', 'API'],
                actionItems: [
                  { description: 'Build Django API', assigned_to: 'mentee', due_date: '2024-01-01', completed: false },
                ],
                learningOutcomes: ['Django models', 'REST API design'],
                nextSteps: ['Deploy API', 'Add authentication'],
              }),
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await AISummaryService._generateWithAnthropic(
        'This is a test transcript about Python and Django',
        'Python Session',
      );

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('model');
      expect(result.summary.keyTopics).toContain('Python');
      expect(result.tokensUsed).toBe(150);
    });

    it('should throw error when ANTHROPIC_API_KEY is not configured', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      await expect(
        AISummaryService._generateWithAnthropic('test transcript'),
      ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');

      process.env.ANTHROPIC_API_KEY = originalKey;
    });
  });

  describe('generateSummary', () => {
    it('should use OpenAI as primary provider', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const mockOpenAIResponse = {
        data: {
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4-turbo-preview',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  keyTopics: ['Topic 1'],
                  actionItems: [],
                  learningOutcomes: [],
                  nextSteps: [],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockOpenAIResponse);

      const result = await AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'Test transcript content',
        sessionTitle: 'Test Session',
      });

      expect(result.provider).toBe('openai');
      expect(result.summary).toBeDefined();
    });

    it('should fallback to Anthropic when OpenAI fails', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      mockedAxios.post
        .mockRejectedValueOnce(new Error('OpenAI failed'))
        .mockResolvedValueOnce({
          data: {
            id: 'test-id',
            type: 'message',
            model: 'claude-3-opus-20240229',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  keyTopics: ['Topic 1'],
                  actionItems: [],
                  learningOutcomes: [],
                  nextSteps: [],
                }),
              },
            ],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        });

      const result = await AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'Test transcript content',
      });

      expect(result.provider).toBe('anthropic');
    });

    it('should throw error when content is insufficient', async () => {
      await expect(
        AISummaryService.generateSummary({
          bookingId: 'booking-1',
          transcriptText: 'short',
        }),
      ).rejects.toThrow('Insufficient content for summary generation');
    });

    it('should combine transcript and notes', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const mockResponse = {
        data: {
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4-turbo-preview',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  keyTopics: ['Topic 1'],
                  actionItems: [],
                  learningOutcomes: [],
                  nextSteps: [],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      await AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'Transcript content',
        sessionNotes: 'Session notes',
      });

      const callArgs = mockedAxios.post.mock.calls[0];
      const userPrompt = callArgs[1].messages[1].content;
      expect(userPrompt).toContain('Transcript content');
      expect(userPrompt).toContain('Session notes');
    });
  });

  describe('generateRecommendations', () => {
    it('should generate AI recommendations when OpenAI is available', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const mockResponse = {
        data: {
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4-turbo-preview',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  recommendations: [
                    'Practice JavaScript daily',
                    'Build a portfolio project',
                    'Learn TypeScript',
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: ['JavaScript', 'React'],
        actionItems: [],
        learningOutcomes: ['React basics'],
        nextSteps: ['Build project'],
        aiConfidence: 0.85,
      };

      const recommendations = await AISummaryService.generateRecommendations(summary);

      expect(recommendations).toHaveLength(3);
      expect(recommendations[0]).toBe('Practice JavaScript daily');
    });

    it('should use fallback recommendations when AI is unavailable', async () => {
      delete process.env.OPENAI_API_KEY;

      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: ['JavaScript'],
        actionItems: [{ description: 'Complete task', completed: false }],
        learningOutcomes: ['Learned basics'],
        nextSteps: ['Next step'],
        aiConfidence: 0.85,
      };

      const recommendations = await AISummaryService.generateRecommendations(summary);

      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('should include mentee goals in AI prompt when provided', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const mockResponse = {
        data: {
          id: 'test-id',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4-turbo-preview',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  recommendations: ['Custom recommendation'],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: ['JavaScript'],
        actionItems: [],
        learningOutcomes: [],
        nextSteps: [],
        aiConfidence: 0.85,
      };

      await AISummaryService.generateRecommendations(summary, ['Learn React', 'Build portfolio']);

      const callArgs = mockedAxios.post.mock.calls[0];
      const userPrompt = callArgs[1].messages[1].content;
      expect(userPrompt).toContain('Learn React');
      expect(userPrompt).toContain('Build portfolio');
    });
  });

  describe('_generateSimpleRecommendations', () => {
    it('should generate recommendations based on key topics', () => {
      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: ['JavaScript', 'React'],
        actionItems: [],
        learningOutcomes: [],
        nextSteps: [],
        aiConfidence: 0.85,
      };

      const recommendations = AISummaryService._generateSimpleRecommendations(summary);

      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('should generate recommendations based on action items', () => {
      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: [],
        actionItems: [
          { description: 'Task 1', completed: false },
          { description: 'Task 2', completed: false },
        ],
        learningOutcomes: [],
        nextSteps: [],
        aiConfidence: 0.85,
      };

      const recommendations = AISummaryService._generateSimpleRecommendations(summary);

      expect(recommendations).toBeDefined();
      expect(recommendations.some(r => r.includes('2'))).toBe(true);
    });

    it('should generate recommendations based on learning outcomes', () => {
      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: [],
        actionItems: [],
        learningOutcomes: ['Learned React components'],
        nextSteps: [],
        aiConfidence: 0.85,
      };

      const recommendations = AISummaryService._generateSimpleRecommendations(summary);

      expect(recommendations).toBeDefined();
      expect(recommendations.some(r => r.includes('React components'))).toBe(true);
    });

    it('should provide default recommendation when no content', () => {
      const summary: SessionSummary = {
        sessionId: 'session-1',
        keyTopics: [],
        actionItems: [],
        learningOutcomes: [],
        nextSteps: [],
        aiConfidence: 0.85,
      };

      const recommendations = AISummaryService._generateSimpleRecommendations(summary);

      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0]).toContain('Review the session notes');
    });
  });
});
