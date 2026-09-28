/**
 * EmotionalTagSelector Component (React Native)
 * 
 * Displays emotional tags organized by category
 * Users can tap tags to insert them into text
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EmotionalTag, getTagsByCategory } from '../utils/emotionalTags';

interface EmotionalTagSelectorProps {
  onTagSelect: (tag: EmotionalTag) => void;
  theme: any;
  maxHeight?: number;
  onLearnMore?: () => void;
  selectedModel?: string; // Unused: every model now supports tags (kept for caller compatibility)
}

// Categories match the backend tagConfig.ts structure
const CATEGORIES = [
  { id: 'emotion', icon: '😊' },
  { id: 'expression', icon: '😂' },
  { id: 'style', icon: '🎭' },
  { id: 'pattern', icon: '🔊' }
];

export const EmotionalTagSelector: React.FC<EmotionalTagSelectorProps> = ({
  onTagSelect,
  theme,
  maxHeight = 300
}) => {
  const { t } = useTranslation();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['emotion']) // Expand emotions by default
  );

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('emotionalTags.title')}</Text>
      
      {/* Scrollable Tag Categories */}
      <ScrollView
        style={[styles.scrollView, { maxHeight }]}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={true}
        bounces={false}
      >
        {CATEGORIES.map(category => {
          const tags = getTagsByCategory(category.id);
          const isExpanded = expandedCategories.has(category.id);

          return (
            <View key={category.id} style={[styles.category, { borderColor: theme.border }]}>
              {/* Category Header */}
              <TouchableOpacity
                style={[styles.categoryHeader, { backgroundColor: theme.card }]}
                onPress={() => toggleCategory(category.id)}
              >
                <View style={styles.categoryHeaderContent}>
                  <Text style={styles.categoryIcon}>{category.icon}</Text>
                  <Text style={[styles.categoryName, { color: theme.text }]}>
                    {t(`emotionalTags.categories.${category.id}`)}
                  </Text>
                  <Text style={[styles.categoryCount, { color: theme.text + '99' }]}>
                    ({tags.length})
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: theme.text + '99' }]}>
                  {isExpanded ? '▼' : '▶'}
                </Text>
              </TouchableOpacity>

              {/* Category Tags */}
              {isExpanded && (
                <View style={[styles.tagsContainer, { backgroundColor: theme.background }]}>
                  {tags.map(tag => (
                    <TouchableOpacity
                      key={tag.id}
                      style={[
                        styles.tag,
                        { backgroundColor: theme.primary + '20', borderColor: theme.primary }
                      ]}
                      onPress={() => onTagSelect(tag)}
                    >
                      {tag.icon && <Text style={styles.tagIcon}>{tag.icon}</Text>}
                      <Text style={[styles.tagLabel, { color: theme.primary }]}>
                        {t(`emotionalTags.tags.${tag.id}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Footer Help */}
      <Text style={[styles.helpText, { color: theme.text + '99' }]}>
        {t('emotionalTags.instruction')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8
  },
  scrollView: {
    marginBottom: 8
  },
  category: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden'
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12
  },
  categoryHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  categoryIcon: {
    fontSize: 18
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600'
  },
  categoryCount: {
    fontSize: 12
  },
  chevron: {
    fontSize: 12
  },
  tagsContainer: {
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4
  },
  tagIcon: {
    fontSize: 14
  },
  tagLabel: {
    fontSize: 13,
    fontWeight: '500'
  },
  helpText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8
  }
});


