import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  Teleport,
  Transition,
  watch,
  type PropType,
  type VNodeChild,
} from 'vue';
import {
  imageActionLabels,
  imagePinchCenter,
  imageTransformStyle,
  imageWheelRatio,
  initialImageTransform,
  lockImagePreviewScroll,
  reboundImage,
  zoomImage,
  type ImageActionIconName,
  type ImageGalleryItem,
  type ImageGeometry,
  type ImageIconName,
  type ImageLoadStatus,
} from '@ai-markdown/core/components';

/** Vue host for the rc-image 1.10 interaction contract and the supplied skin. */
export const ImagePreview = defineComponent({
  props: {
    open: Boolean,
    items: { type: Array as PropType<readonly ImageGalleryItem[]>, required: true },
    current: { type: Number, required: true },
    renderIcon: { type: Function as PropType<(name: ImageIconName) => VNodeChild>, required: true },
    onCurrentChange: { type: Function as PropType<(index: number) => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    afterClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const dialog = ref<HTMLDialogElement>(),
      image = ref<HTMLImageElement>();
    const transform = shallowRef(initialImageTransform()),
      status = ref<ImageLoadStatus>('loading'),
      moving = ref(false),
      touching = ref(false);
    const view = shallowRef({ items: props.items, current: props.current });
    let release: (() => void) | undefined;
    let drag: { x: number; y: number; initialX: number; initialY: number } | undefined;
    let touch:
      | { kind: 'move'; x: number; y: number }
      | { kind: 'zoom'; a: { x: number; y: number }; b: { x: number; y: number } }
      | undefined;
    const geometry = (): ImageGeometry | undefined => {
      const img = image.value;
      if (!img) return;
      return {
        width: img.width,
        height: img.height,
        left: img.offsetLeft,
        top: img.offsetTop,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
      };
    };
    const zoom = (ratio: number, x?: number, y?: number, isTouch = false) => {
      const box = geometry();
      if (box && status.value === 'ready') transform.value = zoomImage(transform.value, ratio, box, x, y, isTouch);
    };
    const rebound = () => {
      const box = geometry(),
        img = image.value;
      if (box && img) transform.value = reboundImage(transform.value, box, img.getBoundingClientRect());
    };
    const move = (delta: number) => {
      const target = props.current + delta;
      if (target >= 0 && target < props.items.length) props.onCurrentChange(target);
    };
    const mouseMove = (event: MouseEvent) => {
      if (props.open && drag)
        transform.value = { ...transform.value, x: event.clientX - drag.x, y: event.clientY - drag.y };
    };
    const mouseUp = () => {
      if (!drag) return;
      const changed = transform.value.x !== drag.initialX || transform.value.y !== drag.initialY;
      drag = undefined;
      moving.value = false;
      if (changed) rebound();
    };
    watch(
      () => props.open,
      (open, _, cleanup) => {
        if (!open) {
          drag = undefined;
          touch = undefined;
          moving.value = touching.value = false;
          return;
        }
        window.addEventListener('mousemove', mouseMove);
        window.addEventListener('mouseup', mouseUp);
        let top: Window | undefined;
        try {
          if (window.top && window.top !== window) {
            top = window.top;
            top.addEventListener('mousemove', mouseMove);
            top.addEventListener('mouseup', mouseUp);
          }
        } catch {
          top = undefined;
        }
        cleanup(() => {
          window.removeEventListener('mousemove', mouseMove);
          window.removeEventListener('mouseup', mouseUp);
          top?.removeEventListener('mousemove', mouseMove);
          top?.removeEventListener('mouseup', mouseUp);
        });
      }
    );
    watch(
      [() => props.open, () => props.current, () => props.items],
      () => {
        if (props.open && props.items[props.current]) view.value = { items: props.items, current: props.current };
      },
      { immediate: true }
    );
    watch(
      [
        () => props.open,
        () => view.value.items[view.value.current]?.id,
        () => view.value.items[view.value.current]?.src,
      ],
      () => {
        if (!props.open) return;
        transform.value = initialImageTransform();
        status.value = 'loading';
        moving.value = touching.value = false;
        drag = undefined;
        touch = undefined;
        void nextTick(() => {
          dialog.value?.focus();
          if (image.value?.complete) status.value = image.value.naturalWidth ? 'ready' : 'error';
        });
      }
    );
    onBeforeUnmount(() => {
      release?.();
    });
    const touchPoint = (point: Touch) => ({ x: point.clientX, y: point.clientY });
    const touchEnd = () => {
      touch = undefined;
      touching.value = false;
      rebound();
    };
    const action = (name: ImageActionIconName) => {
      if (name === 'close') props.onClose();
      else if (name === 'prev') move(-1);
      else if (name === 'next') move(1);
      else if (name === 'zoomIn') zoom(1.5);
      else if (name === 'zoomOut') zoom(1 / 1.5);
      else if (name === 'rotateLeft') transform.value = { ...transform.value, rotate: transform.value.rotate - 90 };
      else if (name === 'rotateRight') transform.value = { ...transform.value, rotate: transform.value.rotate + 90 };
      else if (name === 'flipX') transform.value = { ...transform.value, flipX: !transform.value.flipX };
      else if (name === 'flipY') transform.value = { ...transform.value, flipY: !transform.value.flipY };
    };
    const button = (name: ImageActionIconName, className: string, disabled = false) =>
      h(
        'button',
        {
          type: 'button',
          class: [className, disabled && `${className.split(' ')[0]}-disabled`],
          disabled,
          'aria-label': imageActionLabels[name],
          title: imageActionLabels[name],
          onClick: () => action(name),
        },
        [props.renderIcon(name)]
      );
    return () => {
      const item = view.value.items[view.value.current];
      const prefix = 'aimd-image-preview';
      return h(
        Teleport,
        { to: 'body' },
        h(
          Transition,
          {
            name: 'aimd-image-fade',
            appear: true,
            onEnter: (element: Element) => {
              const modal = element as HTMLDialogElement;
              if (!modal.open) modal.showModal();
              release?.();
              release = lockImagePreviewScroll(document.body);
              modal.focus();
            },
            onAfterLeave: (element: Element) => {
              (element as HTMLDialogElement).close();
              release?.();
              release = undefined;
              props.afterClose();
            },
          },
          {
            default: () =>
              props.open && item
                ? h(
                    'dialog',
                    {
                      ref: dialog,
                      class: [prefix, `${prefix}-movable`, moving.value && `${prefix}-moving`],
                      'aria-label': item.alt || 'Image preview',
                      'aria-modal': 'true',
                      role: 'dialog',
                      tabindex: -1,
                      onCancel: (event: Event) => {
                        event.preventDefault();
                        props.onClose();
                      },
                      onKeydown: (event: KeyboardEvent) => {
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          move(-1);
                        } else if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          move(1);
                        }
                      },
                    },
                    [
                      h('div', { class: `${prefix}-mask`, onClick: props.onClose }),
                      h('div', { class: `${prefix}-body` }, [
                        h('img', {
                          ref: image,
                          key: item.src + view.value.current,
                          class: `${prefix}-img`,
                          src: item.src,
                          alt: item.alt,
                          draggable: false,
                          style: {
                            transform: imageTransformStyle(transform.value),
                            transitionDuration: moving.value || touching.value ? '0s' : undefined,
                            visibility: status.value === 'ready' ? 'visible' : 'hidden',
                          },
                          onLoad: () => {
                            status.value = 'ready';
                          },
                          onError: () => {
                            status.value = 'error';
                          },
                          onMousedown: (event: MouseEvent) => {
                            if (event.button !== 0 || status.value !== 'ready') return;
                            event.preventDefault();
                            event.stopPropagation();
                            moving.value = true;
                            drag = {
                              x: event.clientX - transform.value.x,
                              y: event.clientY - transform.value.y,
                              initialX: transform.value.x,
                              initialY: transform.value.y,
                            };
                          },
                          onWheel: (event: WheelEvent) => {
                            if (event.deltaY) {
                              event.preventDefault();
                              zoom(imageWheelRatio(event.deltaY), event.clientX, event.clientY);
                            }
                          },
                          onDblclick: (event: MouseEvent) => {
                            if (transform.value.scale !== 1)
                              transform.value = { ...transform.value, x: 0, y: 0, scale: 1 };
                            else zoom(1.5, event.clientX, event.clientY);
                          },
                          onTouchstart: (event: TouchEvent) => {
                            if (status.value !== 'ready' || !event.touches.length) return;
                            event.stopPropagation();
                            touching.value = true;
                            touch =
                              event.touches.length > 1
                                ? { kind: 'zoom', a: touchPoint(event.touches[0]), b: touchPoint(event.touches[1]) }
                                : {
                                    kind: 'move',
                                    x: event.touches[0].clientX - transform.value.x,
                                    y: event.touches[0].clientY - transform.value.y,
                                  };
                          },
                          onTouchmove: (event: TouchEvent) => {
                            if (!touch || !event.touches.length) return;
                            event.preventDefault();
                            if (touch.kind === 'zoom' && event.touches.length > 1) {
                              const a = touchPoint(event.touches[0]),
                                b = touchPoint(event.touches[1]);
                              const center = imagePinchCenter(touch.a, touch.b, a, b);
                              zoom(
                                Math.hypot(a.x - b.x, a.y - b.y) /
                                  Math.hypot(touch.a.x - touch.b.x, touch.a.y - touch.b.y),
                                center.x,
                                center.y,
                                true
                              );
                              touch = { kind: 'zoom', a, b };
                            } else if (touch.kind === 'move')
                              transform.value = {
                                ...transform.value,
                                x: event.touches[0].clientX - touch.x,
                                y: event.touches[0].clientY - touch.y,
                              };
                          },
                          onTouchend: touchEnd,
                          onTouchcancel: touchEnd,
                        }),
                        status.value !== 'ready' &&
                          h(
                            'span',
                            { class: 'aimd-image-feedback', role: status.value === 'error' ? 'alert' : 'status' },
                            [
                              props.renderIcon(status.value === 'error' ? 'error' : 'placeholder'),
                              h('span', status.value === 'error' ? 'Image could not be loaded.' : 'Loading image…'),
                            ]
                          ),
                      ]),
                      button('close', `${prefix}-close`),
                      view.value.items.length > 1 && [
                        button('prev', `${prefix}-switch ${prefix}-switch-prev`, view.value.current === 0),
                        button(
                          'next',
                          `${prefix}-switch ${prefix}-switch-next`,
                          view.value.current === view.value.items.length - 1
                        ),
                      ],
                      h('div', { class: `${prefix}-footer` }, [
                        view.value.items.length > 1 &&
                          h(
                            'div',
                            { class: `${prefix}-progress`, role: 'status' },
                            `${view.value.current + 1} / ${view.value.items.length}`
                          ),
                        h(
                          'div',
                          { class: `${prefix}-actions`, role: 'group', 'aria-label': 'Image preview actions' },
                          (['flipY', 'flipX', 'rotateLeft', 'rotateRight', 'zoomOut', 'zoomIn'] as const).map((name) =>
                            button(
                              name,
                              `${prefix}-actions-action ${prefix}-actions-action-${name}`,
                              status.value !== 'ready' ||
                                (name === 'zoomOut' && transform.value.scale <= 1) ||
                                (name === 'zoomIn' && transform.value.scale >= 50)
                            )
                          )
                        ),
                      ]),
                    ]
                  )
                : null,
          }
        )
      );
    };
  },
});
