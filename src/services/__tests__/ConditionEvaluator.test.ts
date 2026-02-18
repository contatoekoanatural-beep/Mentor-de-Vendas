
import { describe, it, expect } from 'vitest';
import {
    evaluateOperator,
    evaluateConditionNode,
    prepareHandover,
    type VariableContext
} from '../ConditionEvaluator';
import type { DynamicConditionNode, ConditionOperator } from '../../types';

describe('ConditionEvaluator', () => {
    describe('evaluateOperator', () => {
        it('should handle "equals" correctly', () => {
            expect(evaluateOperator('equals', 'test', 'test')).toBe(true);
            expect(evaluateOperator('equals', 'Test', 'test')).toBe(true); // Case check
            expect(evaluateOperator('equals', 'test', 'other')).toBe(false);
        });

        it('should handle "not_equals" correctly', () => {
            expect(evaluateOperator('not_equals', 'test', 'other')).toBe(true);
            expect(evaluateOperator('not_equals', 'test', 'test')).toBe(false);
        });

        it('should handle numeric comparisons correctly', () => {
            expect(evaluateOperator('greater_than', 10, 5)).toBe(true);
            expect(evaluateOperator('greater_than', 5, 10)).toBe(false);
            expect(evaluateOperator('less_than', 5, 10)).toBe(true);
            expect(evaluateOperator('greater_or_equal', 10, 10)).toBe(true);
        });

        it('should handle "contains" correctly', () => {
            expect(evaluateOperator('contains', 'hello world', 'world')).toBe(true);
            expect(evaluateOperator('contains', 'hello world', 'foo')).toBe(false);
        });

        it('should handle "in_list" correctly', () => {
            expect(evaluateOperator('in_list', 'SP', ['SP', 'RJ', 'MG'])).toBe(true);
            expect(evaluateOperator('in_list', 'BA', ['SP', 'RJ', 'MG'])).toBe(false);
            expect(evaluateOperator('in_list', 'SP', 'SP, RJ, MG')).toBe(true);
        });

        it('should handle empty checks correctly', () => {
            expect(evaluateOperator('is_empty', '', null)).toBe(true);
            expect(evaluateOperator('is_empty', null, null)).toBe(true);
            expect(evaluateOperator('is_empty', 'foo', null)).toBe(false);
            expect(evaluateOperator('is_not_empty', 'foo', null)).toBe(true);
        });
    });

    describe('evaluateConditionNode', () => {
        const mockNode: DynamicConditionNode = {
            id: 'node-1',
            name: 'Test Node',
            productId: 'prod-1',
            variable: {
                name: 'test_var',
                template: '{{test_var}}',
                type: 'string',
                source: 'custom'
            },
            conditions: [
                {
                    id: 'cond-1',
                    priority: 1,
                    operator: 'equals',
                    value: 'success',
                    action: {
                        type: 'goto_node',
                        targetNodeId: 'node-success'
                    }
                },
                {
                    id: 'cond-2',
                    priority: 2,
                    operator: 'equals',
                    value: 'fail',
                    action: {
                        type: 'end_journey'
                    }
                }
            ],
            defaultAction: {
                type: 'goto_node',
                targetNodeId: 'node-default'
            },
            createdAt: {} as any,
            updatedAt: {} as any
        };

        it('should match first condition', () => {
            const context: VariableContext = { test_var: 'success' };
            const result = evaluateConditionNode(mockNode, context);

            expect(result.matched).toBe(true);
            expect(result.action.type).toBe('goto_node');
            expect(result.action.targetNodeId).toBe('node-success');
        });

        it('should match second condition', () => {
            const context: VariableContext = { test_var: 'fail' };
            const result = evaluateConditionNode(mockNode, context);

            expect(result.matched).toBe(true);
            expect(result.action.type).toBe('end_journey');
        });

        it('should use default action when no condition matches', () => {
            const context: VariableContext = { test_var: 'unknown' };
            const result = evaluateConditionNode(mockNode, context);

            expect(result.matched).toBe(false);
            expect(result.action.type).toBe('goto_node');
            expect(result.action.targetNodeId).toBe('node-default');
        });
    });

    describe('prepareHandover', () => {
        it('should return null if action type is not goto_funnel', () => {
            const action = { type: 'goto_node' } as any;
            expect(prepareHandover(action, {}, 'funnel-1')).toBeNull();
        });

        it('should prepare handover data correctly with preserved history', () => {
            const action = {
                type: 'goto_funnel',
                targetFunnelId: 'funnel-2',
                handover: {
                    preserveHistory: true,
                    transferData: ['name', 'email'],
                    addNote: 'Transfer test'
                }
            } as any;

            const leadData = {
                id: 'lead-1',
                name: 'John Doe',
                email: 'john@example.com',
                ignored: 'value'
            };

            const result = prepareHandover(action, leadData, 'funnel-1');

            expect(result).not.toBeNull();
            expect(result?.fromFunnelId).toBe('funnel-1');
            expect(result?.toFunnelId).toBe('funnel-2');
            expect(result?.preservedData).toEqual({
                name: 'John Doe',
                email: 'john@example.com'
            });
            expect(result?.preservedData).not.toHaveProperty('ignored');
            expect(result?.reason).toBe('Transfer test');
        });
    });
});
