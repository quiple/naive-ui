import {
  h,
  ref,
  onMounted,
  computed,
  defineComponent,
  PropType,
  toRef,
  provide,
  nextTick,
  watch,
  WatchStopHandle,
  CSSProperties
} from 'vue'
import { TreeNode, createIndexGetter } from 'treemate'
import { VirtualList, VirtualListInst } from 'vueuc'
import { depx, getPadding, happensIn } from 'seemly'
import { NEmpty } from '../../../empty'
import { NScrollbar } from '../../scrollbar'
import type { ScrollbarInst } from '../../scrollbar'
import type {
  SelectOption,
  SelectGroupOption,
  SelectIgnoredOption,
  Value,
  SelectTreeMate
} from '../../../select/src/interface'
import {
  formatLength,
  resolveSlot,
  resolveWrappedSlot,
  useOnResize
} from '../../../_utils'
import { createKey } from '../../../_utils/cssr'
import { useThemeClass, useTheme } from '../../../_mixins'
import type { ThemeProps } from '../../../_mixins'
import NInternalLoading from '../../loading'
import NFocusDetector from '../../focus-detector'
import { internalSelectMenuLight, InternalSelectMenuTheme } from '../styles'
import NSelectOption from './SelectOption'
import NSelectGroupHeader from './SelectGroupHeader'
import type {
  RenderLabel,
  Size,
  InternalExposedProps,
  RenderOption
} from './interface'
import {
  internalSelectionMenuInjectionKey,
  internalSelectionMenuBodyInjectionKey
} from './interface'
import style from './styles/index.cssr'

export default defineComponent({
  name: 'InternalSelectMenu',
  props: {
    ...(useTheme.props as ThemeProps<InternalSelectMenuTheme>),
    clsPrefix: {
      type: String,
      required: true
    },
    scrollable: {
      type: Boolean,
      default: true
    },
    treeMate: {
      type: Object as PropType<SelectTreeMate>,
      required: true
    },
    multiple: Boolean,
    size: {
      type: String as PropType<Size>,
      default: 'medium'
    },
    value: {
      type: [String, Number, Array] as PropType<Value | null>,
      default: null
    },
    width: [Number, String],
    autoPending: Boolean,
    virtualScroll: {
      type: Boolean,
      default: true
    },
    // show is used to toggle pending state initialization
    show: {
      type: Boolean,
      default: true
    },
    loading: Boolean,
    focusable: Boolean,
    renderLabel: Function as PropType<RenderLabel>,
    renderOption: Function as PropType<RenderOption>,
    onMousedown: Function as PropType<(e: MouseEvent) => void>,
    onScroll: Function as PropType<(e: Event) => void>,
    onFocus: Function as PropType<(e: FocusEvent) => void>,
    onBlur: Function as PropType<(e: FocusEvent) => void>,
    onKeyup: Function as PropType<(e: KeyboardEvent) => void>,
    onKeydown: Function as PropType<(e: KeyboardEvent) => void>,
    onTabOut: Function as PropType<() => void>,
    onMouseenter: Function as PropType<(e: MouseEvent) => void>,
    onMouseleave: Function as PropType<(e: MouseEvent) => void>,
    onResize: Function as PropType<() => void>,
    resetMenuOnOptionsChange: {
      type: Boolean,
      default: true
    },
    inlineThemeDisabled: Boolean,
    // deprecated
    onToggle: Function as PropType<(tmNode: TreeNode<SelectOption>) => void>
  },
  setup (props) {
    const themeRef = useTheme(
      'InternalSelectMenu',
      '-internal-select-menu',
      style,
      internalSelectMenuLight,
      props,
      toRef(props, 'clsPrefix')
    )
    const selfRef = ref<HTMLElement | null>(null)
    const virtualListRef = ref<VirtualListInst | null>(null)
    const scrollbarRef = ref<ScrollbarInst | null>(null)
    const flattenedNodesRef = computed(() => props.treeMate.getFlattenedNodes())
    const fIndexGetterRef = computed(() =>
      createIndexGetter(flattenedNodesRef.value)
    )
    const pendingNodeRef = ref<TreeNode<SelectOption> | null>(null)
    function initPendingNode (): void {
      const { treeMate } = props
      let defaultPendingNode: TreeNode<SelectOption> | null = null
      if (props.autoPending) {
        const { value } = props
        if (value === null) {
          defaultPendingNode = treeMate.getFirstAvailableNode()
        } else {
          if (props.multiple) {
            defaultPendingNode = treeMate.getNode(
              ((value as Array<string | number> | null) || [])[
                ((value as Array<string | number> | null) || []).length - 1
              ]
            )
          } else {
            defaultPendingNode = treeMate.getNode(value as string | number)
          }
          if (!defaultPendingNode || defaultPendingNode.disabled) {
            defaultPendingNode = treeMate.getFirstAvailableNode()
          }
        }
        if (defaultPendingNode) {
          setPendingTmNode(defaultPendingNode)
        }
      }
    }

    let initPendingNodeWatchStopHandle: WatchStopHandle | undefined
    watch(
      toRef(props, 'show'),
      (value) => {
        if (value) {
          initPendingNodeWatchStopHandle = watch(
            props.resetMenuOnOptionsChange
              ? [toRef(props, 'treeMate'), toRef(props, 'multiple')]
              : [toRef(props, 'multiple')],
            () => {
              initPendingNode()
              void nextTick(scrollToPendingNode)
            },
            {
              immediate: true
            }
          )
        } else {
          initPendingNodeWatchStopHandle?.()
        }
      },
      {
        immediate: true
      }
    )
    const itemSizeRef = computed(() => {
      return depx(themeRef.value.self[createKey('optionHeight', props.size)])
    })
    const paddingRef = computed(() => {
      return getPadding(themeRef.value.self[createKey('padding', props.size)])
    })
    const valueSetRef = computed(() => {
      if (props.multiple && Array.isArray(props.value)) {
        return new Set(props.value)
      }
      return new Set<string | number>()
    })
    const emptyRef = computed(() => {
      const tmNodes = flattenedNodesRef.value
      return tmNodes && tmNodes.length === 0
    })
    function doToggle (tmNode: TreeNode<SelectOption>): void {
      const { onToggle } = props
      if (onToggle) onToggle(tmNode)
    }
    function doScroll (e: Event): void {
      const { onScroll } = props
      if (onScroll) onScroll(e)
    }
    // required, scroller sync need to be triggered manually
    function handleVirtualListScroll (e: Event): void {
      scrollbarRef.value?.sync()
      doScroll(e)
    }
    function handleVirtualListResize (): void {
      scrollbarRef.value?.sync()
    }
    function getPendingTmNode (): TreeNode<SelectOption> | null {
      const { value: pendingTmNode } = pendingNodeRef
      if (pendingTmNode) return pendingTmNode
      return null
    }
    function handleOptionMouseEnter (
      e: MouseEvent,
      tmNode: TreeNode<SelectOption>
    ): void {
      if (tmNode.disabled) return
      setPendingTmNode(tmNode, false)
    }
    function handleOptionClick (
      e: MouseEvent,
      tmNode: TreeNode<SelectOption>
    ): void {
      if (tmNode.disabled) return
      doToggle(tmNode)
    }
    // keyboard related methods
    function handleKeyUp (e: KeyboardEvent): void {
      if (happensIn(e, 'action')) return
      props.onKeyup?.(e)
    }
    function handleKeyDown (e: KeyboardEvent): void {
      if (happensIn(e, 'action')) return
      props.onKeydown?.(e)
    }
    function handleMouseDown (e: MouseEvent): void {
      props.onMousedown?.(e)
      if (props.focusable) return
      e.preventDefault()
    }
    function next (): void {
      const { value: pendingTmNode } = pendingNodeRef
      if (pendingTmNode) {
        setPendingTmNode(pendingTmNode.getNext({ loop: true }), true)
      }
    }
    function prev (): void {
      const { value: pendingTmNode } = pendingNodeRef
      if (pendingTmNode) {
        setPendingTmNode(pendingTmNode.getPrev({ loop: true }), true)
      }
    }
    function setPendingTmNode (
      tmNode: TreeNode<SelectOption> | null,
      doScroll = false
    ): void {
      pendingNodeRef.value = tmNode
      if (doScroll) scrollToPendingNode()
    }
    function scrollToPendingNode (): void {
      const tmNode = pendingNodeRef.value
      if (!tmNode) return
      const fIndex = fIndexGetterRef.value(tmNode.key)
      if (fIndex === null) return
      if (props.virtualScroll) {
        virtualListRef.value?.scrollTo({ index: fIndex })
      } else {
        scrollbarRef.value?.scrollTo({
          index: fIndex,
          elSize: itemSizeRef.value
        })
      }
    }
    function handleFocusin (e: FocusEvent): void {
      if (selfRef.value?.contains(e.target as any)) {
        props.onFocus?.(e)
      }
    }
    function handleFocusout (e: FocusEvent): void {
      if (!selfRef.value?.contains(e.relatedTarget as any)) {
        props.onBlur?.(e)
      }
    }
    provide(internalSelectionMenuInjectionKey, {
      handleOptionMouseEnter,
      handleOptionClick,
      valueSetRef,
      multipleRef: toRef(props, 'multiple'),
      valueRef: toRef(props, 'value'),
      renderLabelRef: toRef(props, 'renderLabel'),
      renderOptionRef: toRef(props, 'renderOption'),
      pendingTmNodeRef: pendingNodeRef
    })
    provide(internalSelectionMenuBodyInjectionKey, selfRef)
    onMounted(() => {
      const { value } = scrollbarRef
      if (value) value.sync()
    })
    const cssVarsRef = computed(() => {
      const { size } = props
      const {
        common: { cubicBezierEaseInOut },
        self: {
          height,
          borderRadius,
          color,
          groupHeaderTextColor,
          actionDividerColor,
          optionTextColorPressed,
          optionTextColor,
          optionTextColorDisabled,
          optionTextColorActive,
          optionOpacityDisabled,
          optionCheckColor,
          actionTextColor,
          optionColorPending,
          optionColorActive,
          loadingColor,
          loadingSize,
          [createKey('optionFontSize', size)]: fontSize,
          [createKey('optionHeight', size)]: optionHeight,
          [createKey('optionPadding', size)]: optionPadding
        }
      } = themeRef.value
      return {
        '--n-height': height,
        '--n-action-divider-color': actionDividerColor,
        '--n-action-text-color': actionTextColor,
        '--n-bezier': cubicBezierEaseInOut,
        '--n-border-radius': borderRadius,
        '--n-color': color,
        '--n-option-font-size': fontSize,
        '--n-group-header-text-color': groupHeaderTextColor,
        '--n-option-check-color': optionCheckColor,
        '--n-option-color-pending': optionColorPending,
        '--n-option-color-active': optionColorActive,
        '--n-option-height': optionHeight,
        '--n-option-opacity-disabled': optionOpacityDisabled,
        '--n-option-text-color': optionTextColor,
        '--n-option-text-color-active': optionTextColorActive,
        '--n-option-text-color-disabled': optionTextColorDisabled,
        '--n-option-text-color-pressed': optionTextColorPressed,
        '--n-option-padding': optionPadding,
        '--n-option-padding-left': getPadding(optionPadding, 'left'),
        '--n-loading-color': loadingColor,
        '--n-loading-size': loadingSize
      }
    })
    const { inlineThemeDisabled } = props
    const themeClassHandle = inlineThemeDisabled
      ? useThemeClass(
        'internal-select-menu',
        computed(() => props.size[0]),
        cssVarsRef,
        props
      )
      : undefined
    const exposedProps: InternalExposedProps = {
      selfRef,
      next,
      prev,
      getPendingTmNode
    }
    useOnResize(selfRef, props.onResize)
    return {
      mergedTheme: themeRef,
      virtualListRef,
      scrollbarRef,
      itemSize: itemSizeRef,
      padding: paddingRef,
      flattenedNodes: flattenedNodesRef,
      empty: emptyRef,
      virtualListContainer () {
        const { value } = virtualListRef
        return value?.listElRef as HTMLElement
      },
      virtualListContent () {
        const { value } = virtualListRef
        return value?.itemsElRef as HTMLElement
      },
      doScroll,
      handleFocusin,
      handleFocusout,
      handleKeyUp,
      handleKeyDown,
      handleMouseDown,
      handleVirtualListResize,
      handleVirtualListScroll,
      cssVars: inlineThemeDisabled ? undefined : cssVarsRef,
      themeClass: themeClassHandle?.themeClass,
      onRender: themeClassHandle?.onRender,
      ...exposedProps
    }
  },
  render () {
    const {
      $slots,
      virtualScroll,
      clsPrefix,
      mergedTheme,
      themeClass,
      onRender
    } = this
    onRender?.()
    return (
      <div
        ref="selfRef"
        tabindex={this.focusable ? 0 : -1}
        class={[
          `${clsPrefix}-base-select-menu`,
          themeClass,
          this.multiple && `${clsPrefix}-base-select-menu--multiple`
        ]}
        style={[
          { width: formatLength(this.width) },
          this.cssVars as CSSProperties
        ]}
        onFocusin={this.handleFocusin}
        onFocusout={this.handleFocusout}
        onKeyup={this.handleKeyUp}
        onKeydown={this.handleKeyDown}
        onMousedown={this.handleMouseDown}
        onMouseenter={this.onMouseenter}
        onMouseleave={this.onMouseleave}
      >
        {this.loading ? (
          <div class={`${clsPrefix}-base-select-menu__loading`}>
            <NInternalLoading clsPrefix={clsPrefix} strokeWidth={20} />
          </div>
        ) : !this.empty ? (
          <NScrollbar
            ref="scrollbarRef"
            theme={mergedTheme.peers.Scrollbar}
            themeOverrides={mergedTheme.peerOverrides.Scrollbar}
            scrollable={this.scrollable}
            container={virtualScroll ? this.virtualListContainer : undefined}
            content={virtualScroll ? this.virtualListContent : undefined}
            onScroll={virtualScroll ? undefined : this.doScroll}
          >
            {{
              default: () => {
                return virtualScroll ? (
                  <VirtualList
                    ref="virtualListRef"
                    class={`${clsPrefix}-virtual-list`}
                    items={this.flattenedNodes}
                    itemSize={this.itemSize}
                    showScrollbar={false}
                    paddingTop={this.padding.top}
                    paddingBottom={this.padding.bottom}
                    onResize={this.handleVirtualListResize}
                    onScroll={this.handleVirtualListScroll}
                    itemResizable
                  >
                    {{
                      default: ({
                        item: tmNode
                      }: {
                        item: TreeNode<
                        SelectGroupOption | SelectOption | SelectIgnoredOption
                        >
                      }) => {
                        return tmNode.isGroup ? (
                          <NSelectGroupHeader
                            key={tmNode.key}
                            clsPrefix={clsPrefix}
                            tmNode={
                              tmNode as unknown as TreeNode<SelectGroupOption>
                            }
                          />
                        ) : tmNode.ignored ? null : (
                          <NSelectOption
                            clsPrefix={clsPrefix}
                            key={tmNode.key}
                            tmNode={tmNode as unknown as TreeNode<SelectOption>}
                          />
                        )
                      }
                    }}
                  </VirtualList>
                ) : (
                  <div
                    class={`${clsPrefix}-base-select-menu-option-wrapper`}
                    style={{
                      paddingTop: this.padding.top,
                      paddingBottom: this.padding.bottom
                    }}
                  >
                    {this.flattenedNodes.map((tmNode) =>
                      tmNode.isGroup ? (
                        <NSelectGroupHeader
                          key={tmNode.key}
                          clsPrefix={clsPrefix}
                          tmNode={
                            tmNode as unknown as TreeNode<SelectGroupOption>
                          }
                        />
                      ) : (
                        <NSelectOption
                          clsPrefix={clsPrefix}
                          key={tmNode.key}
                          tmNode={tmNode as unknown as TreeNode<SelectOption>}
                        />
                      )
                    )}
                  </div>
                )
              }
            }}
          </NScrollbar>
        ) : (
          <div class={`${clsPrefix}-base-select-menu__empty`} data-empty>
            {resolveSlot($slots.empty, () => [
              <NEmpty
                theme={mergedTheme.peers.Empty}
                themeOverrides={mergedTheme.peerOverrides.Empty}
              />
            ])}
          </div>
        )}
        {resolveWrappedSlot(
          $slots.action,
          (children) =>
            children && [
              <div
                class={`${clsPrefix}-base-select-menu__action`}
                data-action
                key="action"
              >
                {children}
              </div>,
              <NFocusDetector onFocus={this.onTabOut} key="focus-detector" />
            ]
        )}
      </div>
    )
  }
})
