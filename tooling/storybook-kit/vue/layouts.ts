import { defineComponent, h } from 'vue';

/** The same responsive comparison frame used by the React catalog. */
export const ComparisonPanel = defineComponent({
  props: { label: { type: String, required: true } },
  setup:
    (props, { slots }) =>
    () =>
      h('section', { class: 'aim-comparison-panel' }, [
        h('p', { class: 'aim-panel-label' }, props.label),
        h('div', { class: 'aim-panel-content' }, slots.default?.()),
      ]),
});
